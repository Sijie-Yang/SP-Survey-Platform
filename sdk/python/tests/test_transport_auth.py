import json
import time

import pytest

from spsurvey import auth
from spsurvey.errors import ApiError, AuthError, ConflictError
from spsurvey.transport import McpTransport


class FakeHttp:
    """Replaces transport.http_json: a queue of replies, one per request."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []

    def __call__(self, method, url, body=None, headers=None, timeout=60.0):
        self.requests.append((method, url, body, headers))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def rpc_result(data, is_error=False):
    return {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": json.dumps(data)}], "isError": is_error}}


def test_tool_call_sends_bearer_and_parses_json(monkeypatch):
    http = FakeHttp([rpc_result({"success": True, "projects": []})])
    monkeypatch.setattr("spsurvey.transport.http_json", http)
    t = McpTransport("tok", base_url="https://sp-survey.org/")
    assert t.call("survey_list_projects", projectId=None) == {"success": True, "projects": []}
    method, url, body, headers = http.requests[0]
    assert (method, url) == ("POST", "https://sp-survey.org/mcp")
    assert headers["Authorization"] == "Bearer tok"
    assert body["params"] == {"name": "survey_list_projects", "arguments": {}}


def test_errors_are_typed(monkeypatch):
    http = FakeHttp([
        rpc_result({"error": "Project not found", "code": "PROJECT_NOT_FOUND"}, True),
        rpc_result({"error": "Draft changed; re-read expectedDraftUpdatedAt", "code": "DRAFT_CONFLICT"}, True),
        rpc_result({"error": "Missing scope: results:read", "code": "insufficient_scope"}, True),
    ])
    monkeypatch.setattr("spsurvey.transport.http_json", http)
    t = McpTransport("tok")
    with pytest.raises(ApiError) as e:
        t.call("survey_get_draft", projectId="x")
    assert e.value.code == "PROJECT_NOT_FOUND"
    with pytest.raises(ConflictError):
        t.call("survey_replace_draft", projectId="x")
    with pytest.raises(AuthError, match="results:read"):
        t.call("survey_export_responses", projectId="x")


def test_expired_token_is_refreshed_once(monkeypatch):
    http = FakeHttp([AuthError("expired"), rpc_result({"success": True})])
    monkeypatch.setattr("spsurvey.transport.http_json", http)
    t = McpTransport("old", on_auth_error=lambda: "new")
    assert t.call("survey_capabilities") == {"success": True}
    assert http.requests[1][3]["Authorization"] == "Bearer new"


def test_token_resolution_order(tmp_credentials, monkeypatch):
    with pytest.raises(AuthError, match="spsurvey login"):
        auth.resolve_token()
    auth.save_credentials({"access_token": "stored", "expires_at": time.time() + 3600, "base_url": "https://sp-survey.org"})
    assert auth.resolve_token() == "stored"
    monkeypatch.setenv("SPSURVEY_TOKEN", "env")
    assert auth.resolve_token() == "env"
    assert auth.resolve_token("explicit") == "explicit"


def test_stale_stored_token_refreshes(tmp_credentials, monkeypatch):
    auth.save_credentials({"access_token": "stale", "refresh_token": "r1", "client_id": "c", "expires_at": time.time() - 10, "base_url": "https://sp-survey.org"})
    http = FakeHttp([{"access_token": "fresh", "refresh_token": "r2", "expires_in": 3600, "scope": "results:read"}])
    monkeypatch.setattr("spsurvey.auth.http_json", http)
    assert auth.resolve_token() == "fresh"
    assert http.requests[0][2]["grant_type"] == "refresh_token"
    assert auth.load_credentials()["refresh_token"] == "r2"


def test_login_flow_with_loopback_redirect(tmp_credentials, monkeypatch):
    import threading
    import urllib.request

    http = FakeHttp([
        {"client_id": "mcp_abc"},
        {"access_token": "at", "refresh_token": "rt", "expires_in": 3600, "scope": "surveys:read"},
    ])
    monkeypatch.setattr("spsurvey.auth.http_json", http)
    seen = {}

    def fake_open(url):
        seen["url"] = url
        # Pretend the browser approved: hit the loopback redirect with a code.
        from urllib.parse import parse_qs, urlparse
        q = parse_qs(urlparse(url).query)
        cb = f"{q['redirect_uri'][0]}?code=thecode&state={q['state'][0]}"
        threading.Thread(target=lambda: urllib.request.urlopen(cb, timeout=5).read(), daemon=True).start()
        return True

    monkeypatch.setattr("spsurvey.auth.webbrowser.open", fake_open)
    creds = auth.login(base_url="https://sp-survey.org", timeout=10)
    assert creds["access_token"] == "at"
    assert "code_challenge=" in seen["url"] and "code_challenge_method=S256" in seen["url"]
    register, exchange = http.requests
    assert register[1].endswith("/oauth/register") and register[2]["redirect_uris"][0].startswith("http://127.0.0.1:")
    assert exchange[1].endswith("/oauth/token") and exchange[2]["code"] == "thecode" and exchange[2]["client_id"] == "mcp_abc"
    assert auth.load_credentials()["refresh_token"] == "rt"
