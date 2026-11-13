"""Tests for sending to the ingest function (the network is replaced by a stand-in)."""

import json

import httpx
import pytest

from gachacheck_collector.ingest import IngestError, send

URL = "https://example.supabase.co/functions/v1/ingest"


def client_answering(status: int, body: dict, seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_send_posts_the_payload_with_the_secret_header():
    seen = []
    with client_answering(200, {"counts": {"created": 1}, "dry_run": False}, seen) as client:
        reply = send({"source": "x"}, URL, "s3cret", client=client)
    request = seen[0]
    assert reply["counts"] == {"created": 1}
    assert request.method == "POST"
    assert request.headers["x-ingest-secret"] == "s3cret"
    assert json.loads(request.content) == {"source": "x"}
    assert "dry" not in request.url.params


def test_dry_run_adds_the_flag():
    seen = []
    with client_answering(200, {"counts": {}, "dry_run": True}, seen) as client:
        send({}, URL, "s3cret", dry_run=True, client=client)
    assert seen[0].url.params["dry"] == "1"


def test_a_rejected_payload_raises_with_the_details_and_request_id():
    seen = []
    body = {"error": "Payload rejected; nothing was saved", "details": ["articles[0].title: required"], "request_id": "abc-123"}
    with client_answering(400, body, seen) as client:
        with pytest.raises(IngestError) as err:
            send({}, URL, "s3cret", client=client)
    message = str(err.value)
    assert "400" in message and "articles[0].title: required" in message and "abc-123" in message


def test_the_secret_never_appears_in_an_error():
    seen = []
    with client_answering(401, {"error": "Not allowed", "request_id": "r1"}, seen) as client:
        with pytest.raises(IngestError) as err:
            send({}, URL, "s3cret-value", client=client)
    assert "s3cret-value" not in str(err.value)


def test_printing_works_whatever_the_console_encoding(monkeypatch, capsys):
    """Piped output on Windows is cp1252; the official pages use characters it cannot hold."""
    import io
    import sys

    from gachacheck_collector import __main__ as cli
    from gachacheck_collector.models import Article

    narrow = io.TextIOWrapper(io.BytesIO(), encoding="cp1252")
    monkeypatch.setattr(sys, "stdout", narrow)
    monkeypatch.setattr(cli.ADAPTERS["nte"], "collect", lambda: [Article(external_id="1", title="Ver. 1.4 「Test」 Patch Notes ✦")])
    assert cli.main(["nte", "--print"]) == 0
    narrow.flush()
    assert "「Test」".encode("utf-8") in narrow.buffer.getvalue()
