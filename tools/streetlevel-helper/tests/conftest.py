"""Local stubs: Google viewer endpoints (lookup / photometa / tiles) and the Platform media API.

Tests never reach Google. The lookup and photometa bodies are real responses
recorded once for pano F7ng4IZidNWzfUWGIVSwyw; tiles are synthetic.
"""

import base64
import io
import json
from pathlib import Path

import pytest
from aiohttp import web
from PIL import Image

FIXTURES = Path(__file__).parent / "fixtures"
PANO_ID = "F7ng4IZidNWzfUWGIVSwyw"
NOT_FOUND = '/**/_xdc_._x && _xdc_._x( [[5,"generic","Search returned no images."]] )'


def tile_jpeg(x: int, y: int, zoom: int) -> bytes:
    """512×512 tile whose red channel encodes the column, so stitching order is checkable."""
    img = Image.new("RGB", (512, 512), (min(255, x * 30), 80, 160))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


class UpstreamStub:
    def __init__(self):
        self.requests = []
        self.fail_tiles = 0
        self.app = web.Application()
        self.app.router.add_get("/{host}/{path:.*}", self.handle)

    async def handle(self, request):
        host = request.match_info["host"]
        path = request.match_info["path"]
        self.requests.append((host, path, dict(request.query)))
        if host == "maps.googleapis.com" and "SingleImageSearch" in path:
            pb = request.query.get("pb", "")
            if "!3d10." in pb or "!3d-10." in pb:
                return web.Response(text=NOT_FOUND)
            return web.Response(text=(FIXTURES / "single_image_search.txt").read_text())
        if host == "www.google.com" and path.startswith("maps/photometa"):
            return web.Response(text=(FIXTURES / "photometa.txt").read_text())
        if host == "streetviewpixels-pa.googleapis.com":
            if self.fail_tiles > 0:
                self.fail_tiles -= 1
                return web.Response(status=503)
            return web.Response(body=tile_jpeg(int(request.query["x"]), int(request.query["y"]), int(request.query["zoom"])),
                                content_type="image/jpeg")
        return web.Response(status=404)


class FakePlatform:
    """Implements /api/r2/list, /api/r2/upload, public object GET and the street-level project endpoints."""

    def __init__(self, token="good-token", user="user1"):
        self.token = token
        self.user = user
        self.objects = {}
        self.uploads = []
        self.registered = []
        self.project_points = []
        self.app = web.Application(client_max_size=64 * 1024 * 1024)
        self.app.router.add_get("/api/r2/list", self.list)
        self.app.router.add_post("/api/r2/upload", self.upload)
        self.app.router.add_get("/api/street-level/projects/{pid}", self.project)
        self.app.router.add_post("/api/street-level/projects/{pid}/register", self.register)
        self.app.router.add_get("/public/{key:.*}", self.public)
        self.base = ""

    def _authed(self, request):
        return request.headers.get("Authorization") == f"Bearer {self.token}"

    async def list(self, request):
        if not self._authed(request):
            return web.json_response({"success": False, "error": "Authentication required"}, status=401)
        prefix = request.query.get("prefix", "")
        images = [{"key": k, "name": k.split("/")[-1]} for k in self.objects if k.startswith(prefix) and k.endswith(".jpg")]
        return web.json_response({"success": True, "images": images})

    async def upload(self, request):
        if not self._authed(request):
            return web.json_response({"success": False, "error": "Authentication required"}, status=401)
        body = await request.json()
        key = body["key"]
        if not key.startswith(f"{self.user}/"):
            return web.json_response({"success": False, "error": "Key must be under your user prefix"}, status=403)
        self.objects[key] = (base64.b64decode(body["data"]), body.get("contentType"))
        self.uploads.append(key)
        return web.json_response({"success": True, "key": key, "url": f"{self.base}/public/{key}"})

    async def public(self, request):
        hit = self.objects.get(request.match_info["key"])
        if not hit:
            return web.Response(status=404)
        return web.Response(body=hit[0], content_type=(hit[1] or "application/octet-stream").split(";")[0])

    async def project(self, request):
        if not self._authed(request):
            return web.json_response({"success": False}, status=401)
        pid = request.match_info["pid"]
        return web.json_response({"success": True, "projectId": pid, "mediaPrefix": f"{self.user}/{pid}/",
                                  "publicBase": f"{self.base}/public", "points": self.project_points,
                                  "capture": {"preset": "headings", "headingCount": 2, "zoom": 1, "width": 320}})

    async def register(self, request):
        if not self._authed(request):
            return web.json_response({"success": False}, status=401)
        self.registered.append(await request.json())
        return web.json_response({"success": True})


async def _start(app):
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return runner, f"http://127.0.0.1:{port}"


@pytest.fixture
async def upstream():
    stub = UpstreamStub()
    runner, base = await _start(stub.app)
    stub.base = base
    yield stub
    await runner.cleanup()


@pytest.fixture
async def platform_api():
    fake = FakePlatform()
    runner, base = await _start(fake.app)
    fake.base = base
    yield fake
    await runner.cleanup()


def point(pid, lat=1.29745, lng=103.77315, **extra):
    return {"id": pid, "lat": lat, "lng": lng, **extra}


def dumps(obj):
    return json.dumps(obj)
