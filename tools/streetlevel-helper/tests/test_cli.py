"""`sp-streetlevel run` end to end: stub upstream + fake Platform in a background loop."""

import asyncio
import threading

from sp_streetlevel.cli import main

from .conftest import PANO_ID, FakePlatform, UpstreamStub, _start, point


class Servers:
    def __enter__(self):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
        self.upstream = UpstreamStub()
        self.platform = FakePlatform()

        async def boot():
            self.r1, self.upstream.base = await _start(self.upstream.app)
            self.r2, self.platform.base = await _start(self.platform.app)

        asyncio.run_coroutine_threadsafe(boot(), self.loop).result(10)
        return self

    def __exit__(self, *exc):
        async def stop():
            await self.r1.cleanup()
            await self.r2.cleanup()

        asyncio.run_coroutine_threadsafe(stop(), self.loop).result(10)
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(5)


def test_run_command_downloads_uploads_and_registers(monkeypatch, capsys):
    monkeypatch.setenv("SP_SURVEY_TOKEN", "good-token")
    with Servers() as s:
        s.platform.project_points = [point("a", heading=10, label="Gate"), point("far", lat=10.5, lng=10.5)]
        code = main(["run", "--project", "proj9", "--api", s.platform.base, "--upstream-override", s.upstream.base,
                     "--min-interval", "0", "--folder-mode", "set-per-point"])
        out = capsys.readouterr().out
        assert code == 0, out
        assert "done" in out
        imgs = sorted(k for k in s.platform.uploads if k.endswith(".jpg"))
        # project capture options (headings ×2, zoom 1, width 320) merged with CLI flags
        assert imgs == [f"user1/proj9/street-level/Gate/gsv-{PANO_ID}-h010-p00-f090.jpg",
                        f"user1/proj9/street-level/Gate/gsv-{PANO_ID}-h190-p00-f090.jpg"]
        assert "user1/proj9/features/street_level_v1.csv" in s.platform.objects
        reg = s.platform.registered[0]
        assert [e["key"] for e in reg["entries"]] == imgs
        assert reg["tags"] == {"street-level/Gate": "set"}

        uploads = len(s.platform.uploads)
        assert main(["run", "--project", "proj9", "--api", s.platform.base, "--upstream-override", s.upstream.base,
                     "--min-interval", "0", "--folder-mode", "set-per-point"]) == 0
        assert [k for k in s.platform.uploads[uploads:] if k.endswith(".jpg")] == []


def test_run_command_rejects_non_https_api():
    try:
        main(["run", "--project", "p", "--api", "http://evil.example"])
    except ValueError as err:
        assert "https" in str(err)
    else:
        raise AssertionError("expected ValueError")
