"""SP-Survey Platform client: the existing authenticated media upload API only."""

from __future__ import annotations

import base64
import time
from typing import Callable, Optional
from urllib.parse import urlencode, urlsplit

import requests


class AuthError(Exception):
    """Token missing, expired or rejected; the job pauses until a new token arrives."""


class PlatformError(Exception):
    def __init__(self, message: str, status: int = 0, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


def validate_api_base(api_base: str) -> str:
    parts = urlsplit(str(api_base or "").strip())
    if parts.scheme == "https" and parts.hostname:
        return f"https://{parts.netloc}"
    if parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1"):
        return f"http://{parts.netloc}"
    raise ValueError("apiBase must be https:// or http://localhost")


class PlatformClient:
    def __init__(self, api_base: str, token: Callable[[], Optional[str]], timeout: float = 60.0,
                 session: Optional[requests.Session] = None):
        self.api_base = validate_api_base(api_base)
        self._token = token
        self.timeout = timeout
        self.http = session or requests.Session()

    def _headers(self, extra: Optional[dict] = None) -> dict:
        headers = dict(extra or {})
        token = self._token()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _check(self, res: requests.Response, label: str) -> dict:
        if res.status_code in (401, 403):
            raise AuthError(f"{label}: HTTP {res.status_code}")
        if not res.ok:
            raise PlatformError(f"{label}: HTTP {res.status_code} {res.text[:200]}", res.status_code,
                                retryable=res.status_code == 429 or res.status_code >= 500)
        body = res.json()
        if isinstance(body, dict) and body.get("success") is False:
            raise PlatformError(f"{label}: {body.get('error')}")
        return body

    def list_keys(self, prefix: str) -> set:
        res = self.http.get(f"{self.api_base}/api/r2/list?{urlencode({'prefix': prefix})}",
                            headers=self._headers(), timeout=self.timeout)
        body = self._check(res, "R2 list")
        return {img.get("key") for img in body.get("images", []) if img.get("key")}

    def upload(self, key: str, data: bytes, content_type: str) -> str:
        payload = {"key": key, "data": base64.b64encode(data).decode("ascii"), "contentType": content_type}
        res = self.http.post(f"{self.api_base}/api/r2/upload", json=payload,
                             headers=self._headers({"Content-Type": "application/json"}), timeout=self.timeout)
        return self._check(res, "R2 upload").get("url", "")

    def fetch_public_text(self, url: str) -> Optional[str]:
        if not url:
            return None
        res = self.http.get(f"{url}?t={int(time.time())}", timeout=self.timeout)
        return res.text if res.ok else None

    def get_project(self, project_id: str) -> dict:
        res = self.http.get(f"{self.api_base}/api/street-level/projects/{project_id}",
                            headers=self._headers(), timeout=self.timeout)
        return self._check(res, "Load project points")

    def register(self, project_id: str, entries: list, folders: list, tags: dict) -> dict:
        res = self.http.post(f"{self.api_base}/api/street-level/projects/{project_id}/register",
                             json={"entries": entries, "folders": folders, "tags": tags},
                             headers=self._headers({"Content-Type": "application/json"}), timeout=self.timeout)
        return self._check(res, "Register media")
