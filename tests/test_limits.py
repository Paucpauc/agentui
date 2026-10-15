import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.limits import parse_usage_output, LimitsService

SAMPLE_USAGE_JSON = """{
  "conversation_id": "",
  "status": "SUCCESS",
  "response": "Gemini Models\\tWeekly Limit Remaining\\t77%\\t2026-10-18T19:42:07Z\\nGemini Models\\tFive Hour Limit Remaining\\t98%\\t2026-10-14T02:54:07Z\\n",
  "command": {
    "name": "usage",
    "data": {
      "description": "Models share weekly and 5-hour limits.",
      "groups": [
        {
          "name": "Gemini Models",
          "description": "Gemini Flash, Gemini Pro",
          "buckets": [
            {
              "id": "gemini-weekly",
              "name": "Weekly Limit Remaining",
              "window": "weekly",
              "remaining_fraction": 0.772,
              "reset_time": "2026-10-18T19:42:07Z",
              "description": "77% remaining"
            },
            {
              "id": "gemini-5h",
              "name": "Five Hour Limit Remaining",
              "window": "5h",
              "remaining_fraction": 0.984,
              "reset_time": "2026-10-14T02:54:07Z",
              "description": "98% remaining"
            }
          ]
        },
        {
          "name": "Claude and GPT models",
          "description": "Claude Opus, Sonnet",
          "buckets": [
            {
              "id": "3p-weekly",
              "name": "Weekly Limit Remaining",
              "window": "weekly",
              "remaining_fraction": 1.0,
              "reset_time": "2026-10-20T22:00:20Z"
            },
            {
              "id": "3p-5h",
              "name": "Five Hour Limit Remaining",
              "window": "5h",
              "remaining_fraction": 0.50,
              "reset_time": "2026-10-14T03:00:20Z"
            }
          ]
        }
      ]
    }
  }
}"""


def test_parse_usage_output():
    parsed = parse_usage_output(SAMPLE_USAGE_JSON)
    assert parsed["status"] == "ok"
    assert parsed["primary"] is not None
    assert parsed["primary"]["group_name"] == "Gemini Models"

    five_h = parsed["primary"]["five_hour"]
    assert five_h is not None
    assert five_h["percent"] == 98
    assert five_h["remaining_fraction"] == 0.984
    assert five_h["reset_time"] == "2026-10-14T02:54:07Z"

    weekly = parsed["primary"]["weekly"]
    assert weekly is not None
    assert weekly["percent"] == 77
    assert weekly["remaining_fraction"] == 0.772
    assert weekly["reset_time"] == "2026-10-18T19:42:07Z"

    assert len(parsed["groups"]) == 2
    g2 = parsed["groups"][1]
    assert g2["name"] == "Claude and GPT models"
    assert g2["five_hour"]["percent"] == 50
    assert g2["weekly"]["percent"] == 100


def test_parse_usage_output_empty_invalid():
    with pytest.raises(ValueError):
        parse_usage_output("")

    with pytest.raises(Exception):
        parse_usage_output("not json")


@pytest.mark.anyio
async def test_limits_service_refresh_and_cache():
    service = LimitsService(interval_seconds=60)
    mock_data = parse_usage_output(SAMPLE_USAGE_JSON)

    with patch.object(service, "fetch_limits", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.return_value = mock_data

        # First refresh
        data = await service.refresh(force=True)
        assert data["status"] == "ok"
        assert data["primary"]["five_hour"]["percent"] == 98
        assert mock_fetch.call_count == 1

        # Second refresh without force within 10s should return cached data without calling fetch again
        data2 = await service.refresh(force=False)
        assert data2["primary"]["five_hour"]["percent"] == 98
        assert mock_fetch.call_count == 1

        # Force refresh should invoke fetch_limits again
        data3 = await service.refresh(force=True)
        assert mock_fetch.call_count == 2


@pytest.mark.anyio
async def test_limits_service_error_handling():
    service = LimitsService(interval_seconds=60)

    with patch.object(service, "fetch_limits", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.side_effect = RuntimeError("agent command not found")

        data = await service.refresh(force=True)
        assert data["status"] == "error"
        assert "agent command not found" in data["error"]


def test_limits_api_endpoints(monkeypatch):
    monkeypatch.delenv("AUTH_USERNAME", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD", raising=False)
    client = TestClient(app)

    parsed_sample = parse_usage_output(SAMPLE_USAGE_JSON)

    with patch("app.routers.limits.limits_service.fetch_limits", new_callable=AsyncMock) as mock_fetch:
        mock_fetch.return_value = parsed_sample

        # Test GET /api/limits
        resp = client.get("/api/limits?refresh=true")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["primary"]["five_hour"]["percent"] == 98
        assert body["primary"]["weekly"]["percent"] == 77

        # Test POST /api/limits/refresh
        resp_post = client.post("/api/limits/refresh")
        assert resp_post.status_code == 200
        body_post = resp_post.json()
        assert body_post["status"] == "ok"
        assert body_post["primary"]["five_hour"]["percent"] == 98


def test_limits_pty_session_tracking():
    service = LimitsService(interval_seconds=60)
    assert service.has_active_pty_sessions() is False
    assert service.active_session_count == 0

    service.register_pty_session("session_1")
    assert service.has_active_pty_sessions() is True
    assert service.active_session_count == 1

    service.register_pty_session("session_2")
    assert service.active_session_count == 2

    service.unregister_pty_session("session_1")
    assert service.has_active_pty_sessions() is True
    assert service.active_session_count == 1

    service.unregister_pty_session("session_2")
    assert service.has_active_pty_sessions() is False
    assert service.active_session_count == 0


@pytest.mark.anyio
async def test_background_loop_requires_active_pty():
    service = LimitsService(interval_seconds=0.01)

    with patch.object(service, "refresh", new_callable=AsyncMock) as mock_refresh:
        # Start background loop with NO active sessions
        service.start()
        await asyncio.sleep(0.05)
        service.stop()
        # Should not have refreshed because has_active_pty_sessions is False
        assert mock_refresh.call_count == 0

    with patch.object(service, "refresh", new_callable=AsyncMock) as mock_refresh:
        # Start background loop WITH active session
        service.register_pty_session("sess_active")
        service.start()
        await asyncio.sleep(0.05)
        service.stop()
        service.unregister_pty_session("sess_active")
        # Should have refreshed because an active session was present
        assert mock_refresh.call_count >= 1

