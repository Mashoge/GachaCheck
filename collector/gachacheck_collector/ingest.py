"""Sends a payload to GachaCheck's ingest function."""

from __future__ import annotations

import httpx


class IngestError(RuntimeError):
    pass


def send(payload: dict, url: str, secret: str, dry_run: bool = False, client: httpx.Client | None = None) -> dict:
    """POSTs the payload. Returns the function's reply. The secret is never logged or echoed."""
    own_client = client is None
    client = client or httpx.Client(timeout=60.0)
    try:
        response = client.post(
            url,
            params={"dry": "1"} if dry_run else None,
            json=payload,
            headers={"x-ingest-secret": secret},
        )
    finally:
        if own_client:
            client.close()

    try:
        reply = response.json()
    except ValueError:
        reply = {"error": response.text[:300]}

    if response.status_code != 200:
        details = "; ".join(reply.get("details", [])[:10]) if isinstance(reply.get("details"), list) else ""
        raise IngestError(
            f"Ingest answered {response.status_code}: {reply.get('error', 'no message')}"
            f"{' | ' + details if details else ''} (request {reply.get('request_id', 'unknown')})"
        )
    return reply
