"""CLI login through the Platform's existing OAuth (PKCE + loopback redirect).

Only the `run` fallback needs this; the Download button hands the helper the
signed-in browser session's token instead.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import stat
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlencode, urlsplit

import requests

CALLBACK_PORT = 47822
SCOPES = "media:write surveys:read offline_access"
CREDENTIALS_PATH = Path(os.environ.get("SP_STREETLEVEL_CREDENTIALS",
                                       Path.home() / ".config" / "sp-survey" / "streetlevel-credentials.json"))


def _load() -> dict:
    try:
        return json.loads(CREDENTIALS_PATH.read_text())
    except (OSError, ValueError):
        return {}


def _save(data: dict):
    CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CREDENTIALS_PATH.write_text(json.dumps(data, indent=2))
    os.chmod(CREDENTIALS_PATH, stat.S_IRUSR | stat.S_IWUSR)


def _pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def login(api_base: str, open_browser=webbrowser.open, timeout: float = 300.0) -> dict:
    redirect_uri = f"http://127.0.0.1:{CALLBACK_PORT}/callback"
    reg = requests.post(f"{api_base}/oauth/register", json={
        "client_name": "SP-Survey streetlevel helper",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_method": "none",
    }, timeout=30)
    reg.raise_for_status()
    client_id = reg.json()["client_id"]
    verifier, challenge = _pkce()
    state_value = secrets.token_urlsafe(16)
    result: dict = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - http.server API
            query = parse_qs(urlsplit(self.path).query)
            if query.get("state", [""])[0] == state_value:
                result["code"] = query.get("code", [""])[0]
                result["error"] = query.get("error", [""])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write("<p>SP-Survey streetlevel helper is signed in. You can close this tab.</p>".encode())

        def log_message(self, *_args):
            pass

    server = HTTPServer(("127.0.0.1", CALLBACK_PORT), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"{api_base}/oauth/authorize?" + urlencode({
        "response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri,
        "code_challenge": challenge, "code_challenge_method": "S256", "scope": SCOPES,
        "state": state_value, "resource": f"{api_base}/mcp",
    })
    print(f"Opening the browser to sign in:\n  {url}")
    open_browser(url)
    deadline = time.time() + timeout
    while "code" not in result and time.time() < deadline:
        time.sleep(0.2)
    server.shutdown()
    if not result.get("code"):
        raise RuntimeError(result.get("error") or "Sign-in timed out")
    tok = requests.post(f"{api_base}/oauth/token", data={
        "grant_type": "authorization_code", "code": result["code"], "redirect_uri": redirect_uri,
        "client_id": client_id, "code_verifier": verifier,
    }, timeout=30)
    tok.raise_for_status()
    body = tok.json()
    record = {
        "client_id": client_id,
        "access_token": body["access_token"],
        "refresh_token": body.get("refresh_token"),
        "expires_at": time.time() + int(body.get("expires_in") or 3600) - 60,
    }
    creds = _load()
    creds[api_base] = record
    _save(creds)
    return record


def access_token(api_base: str) -> Optional[str]:
    """Cached token for `api_base`, refreshed when expired. None if never signed in."""
    creds = _load()
    record = creds.get(api_base)
    if not record:
        return None
    if record.get("expires_at", 0) > time.time():
        return record["access_token"]
    if not record.get("refresh_token"):
        return None
    res = requests.post(f"{api_base}/oauth/token", data={
        "grant_type": "refresh_token", "refresh_token": record["refresh_token"], "client_id": record["client_id"],
    }, timeout=30)
    if not res.ok:
        return None
    body = res.json()
    record.update(access_token=body["access_token"],
                  refresh_token=body.get("refresh_token", record["refresh_token"]),
                  expires_at=time.time() + int(body.get("expires_in") or 3600) - 60)
    creds[api_base] = record
    _save(creds)
    return record["access_token"]
