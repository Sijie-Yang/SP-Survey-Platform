"""Tokens: ``spsurvey login`` runs the platform's OAuth flow (PKCE, loopback
redirect) in the browser and stores the result in the user's config folder.
``SPSURVEY_TOKEN`` overrides the stored token (for CI and agents)."""
from __future__ import annotations

import base64
import hashlib
import http.server
import json
import os
import secrets
import threading
import time
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Optional

from .errors import AuthError
from .transport import DEFAULT_BASE_URL, http_json

ALL_SCOPES = ["surveys:read", "surveys:write", "surveys:publish", "media:write", "results:read", "offline_access"]
ENV_TOKEN = "SPSURVEY_TOKEN"
ENV_BASE_URL = "SPSURVEY_BASE_URL"


def credentials_path() -> Path:
    override = os.environ.get("SPSURVEY_CREDENTIALS")
    if override:
        return Path(override)
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return Path(base) / "spsurvey" / "credentials.json"


def load_credentials() -> dict:
    path = credentials_path()
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def save_credentials(data: dict) -> Path:
    path = credentials_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), "utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path


def clear_credentials() -> None:
    try:
        credentials_path().unlink()
    except OSError:
        pass


def resolve_base_url(base_url: Optional[str] = None) -> str:
    return (base_url or os.environ.get(ENV_BASE_URL) or load_credentials().get("base_url") or DEFAULT_BASE_URL).rstrip("/")


def resolve_token(token: Optional[str] = None, base_url: Optional[str] = None) -> str:
    """Explicit token, then the environment, then the stored login (refreshed when expired)."""
    if token:
        return token
    env = os.environ.get(ENV_TOKEN)
    if env:
        return env
    creds = load_credentials()
    if creds.get("access_token"):
        if creds.get("expires_at", 0) - 60 < time.time() and creds.get("refresh_token"):
            creds = refresh(creds, base_url=base_url)
        return creds["access_token"]
    raise AuthError("Not logged in. Run `spsurvey login` or set SPSURVEY_TOKEN.")


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


class _CodeCatcher(http.server.BaseHTTPRequestHandler):
    result: dict = {}

    def do_GET(self):  # noqa: N802 (http.server API)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _CodeCatcher.result = {k: v[0] for k, v in query.items()}
        ok = "code" in query
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        body = "<h2>SP-Survey: you can close this tab.</h2>" if ok else "<h2>SP-Survey login was not approved.</h2>"
        self.wfile.write(body.encode("utf-8"))

    def log_message(self, *_args):  # silence the server
        return


def login(base_url: Optional[str] = None, scopes: Optional[list] = None, open_browser: bool = True, timeout: float = 300.0,
          client_name: str = "spsurvey Python SDK") -> dict:
    """Interactive login. Returns and stores ``{access_token, refresh_token, expires_at, ...}``."""
    base = resolve_base_url(base_url)
    scopes = scopes or ALL_SCOPES
    server = http.server.HTTPServer(("127.0.0.1", 0), _CodeCatcher)
    port = server.server_address[1]
    redirect_uri = f"http://127.0.0.1:{port}/callback"
    _CodeCatcher.result = {}

    client = http_json("POST", f"{base}/oauth/register", {"client_name": client_name, "redirect_uris": [redirect_uri]})
    client_id = client["client_id"]
    verifier = _b64url(secrets.token_bytes(48))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    state = _b64url(secrets.token_bytes(16))
    params = {
        "response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256", "scope": " ".join(scopes), "resource": f"{base}/mcp",
    }
    url = f"{base}/oauth/authorize?{urllib.parse.urlencode(params)}"

    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()
    print(f"Open this link to approve access:\n  {url}")
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
    thread.join(timeout)
    server.server_close()
    result = _CodeCatcher.result
    if not result.get("code"):
        raise AuthError(result.get("error") or "Login timed out or was denied.")
    if result.get("state") != state:
        raise AuthError("Login state mismatch; try again.")

    token = http_json("POST", f"{base}/oauth/token", {
        "grant_type": "authorization_code", "code": result["code"], "redirect_uri": redirect_uri,
        "client_id": client_id, "code_verifier": verifier, "resource": f"{base}/mcp",
    })
    creds = _store(token, base, client_id)
    return creds


def refresh(creds: Optional[dict] = None, base_url: Optional[str] = None) -> dict:
    creds = creds or load_credentials()
    base = resolve_base_url(base_url or creds.get("base_url"))
    if not creds.get("refresh_token"):
        raise AuthError("No refresh token stored. Run `spsurvey login`.")
    token = http_json("POST", f"{base}/oauth/token", {
        "grant_type": "refresh_token", "refresh_token": creds["refresh_token"], "client_id": creds.get("client_id", ""),
    })
    return _store(token, base, creds.get("client_id", ""))


def _store(token: dict, base: str, client_id: str) -> dict:
    creds = {
        "base_url": base,
        "client_id": client_id,
        "access_token": token["access_token"],
        "refresh_token": token.get("refresh_token", ""),
        "expires_at": time.time() + float(token.get("expires_in") or 3600),
        "scope": token.get("scope", ""),
    }
    save_credentials(creds)
    return creds
