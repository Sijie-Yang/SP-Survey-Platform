"""HTTP transport: the SDK speaks to the platform's MCP endpoint (JSON-RPC over
HTTPS), which accepts both an OAuth token from ``spsurvey login`` and a
Supabase session token. Only the standard library is used."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Callable, Optional

from .errors import ApiError, AuthError, ConflictError

DEFAULT_BASE_URL = "https://sp-survey.org"
USER_AGENT = "spsurvey-python/0.1.0"


def http_json(method: str, url: str, body: Optional[dict] = None, headers: Optional[dict] = None, timeout: float = 60.0) -> Any:
    """One JSON request with urllib. Raises ApiError on a non-2xx reply."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", USER_AGENT)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (https URL built by the SDK)
            text = res.read().decode("utf-8")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", "replace")
        try:
            payload = json.loads(text) if text else {}
        except ValueError:
            payload = {"error": text[:300]}
        message = payload.get("error") or payload.get("error_description") or f"HTTP {err.code}"
        if err.code in (401, 403):
            raise AuthError(f"{message} (HTTP {err.code}). Run `spsurvey login` or set SPSURVEY_TOKEN.") from None
        raise ApiError(str(message), code=str(payload.get("code") or ""), status=err.code, details=payload) from None


class McpTransport:
    """Calls MCP tools on ``{base_url}/mcp`` with a bearer token."""

    def __init__(self, token: str, base_url: str = DEFAULT_BASE_URL, timeout: float = 120.0,
                 on_auth_error: Optional[Callable[[], Optional[str]]] = None):
        if not token:
            raise AuthError("No token. Run `spsurvey login` or set SPSURVEY_TOKEN.")
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._on_auth_error = on_auth_error
        self._id = 0

    def _rpc(self, method: str, params: Optional[dict] = None) -> Any:
        self._id += 1
        body = {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}
        headers = {"Authorization": f"Bearer {self.token}"}
        try:
            reply = http_json("POST", f"{self.base_url}/mcp", body, headers, timeout=self.timeout)
        except AuthError:
            if not self._on_auth_error:
                raise
            fresh = self._on_auth_error()
            if not fresh:
                raise
            self.token = fresh
            headers["Authorization"] = f"Bearer {fresh}"
            reply = http_json("POST", f"{self.base_url}/mcp", body, headers, timeout=self.timeout)
        if not isinstance(reply, dict):
            raise ApiError("Unexpected reply from the platform")
        if reply.get("error"):
            err = reply["error"]
            raise ApiError(str(err.get("message") or err), code=str(err.get("code") or ""), details=err)
        return reply.get("result")

    def list_tools(self) -> list:
        return (self._rpc("tools/list") or {}).get("tools", [])

    def call(self, tool: str, **arguments) -> Any:
        """Call one tool. The tool's JSON result is returned as Python data."""
        result = self._rpc("tools/call", {"name": tool, "arguments": {k: v for k, v in arguments.items() if v is not None}})
        content = (result or {}).get("content") or []
        text = "".join(part.get("text", "") for part in content if part.get("type") == "text")
        try:
            data = json.loads(text) if text else {}
        except ValueError:
            data = {"text": text}
        if (result or {}).get("isError") or (isinstance(data, dict) and data.get("success") is False):
            message = data.get("error") if isinstance(data, dict) else text
            code = str(data.get("code") or "") if isinstance(data, dict) else ""
            if code in ("DRAFT_CONFLICT", "CONFLICT") or "expectedDraftUpdatedAt" in str(message):
                raise ConflictError(str(message), code=code, details=data)
            if code == "insufficient_scope":
                raise AuthError(f"{message}. Log in again and tick that permission.")
            raise ApiError(str(message or "Tool call failed"), code=code, details=data)
        return data
