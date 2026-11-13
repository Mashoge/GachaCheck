"""The records the collector sends. Field names match the ingest contract exactly."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class Observation:
    """One dated item an article mentions (an event, a web event, an endgame cycle)."""

    observed_key: str  # stable inside the article; stays the same when the publisher edits a date
    kind: str  # event | web_event | banner | endgame_cycle
    name: str
    version: str = ""
    server_scope: str = "all"
    occurrence_key: str = ""
    starts_local: str | None = None  # 'YYYY-MM-DDTHH:MM', exactly as printed (no conversion)
    ends_local: str | None = None
    time_basis: str = "server_local"  # server_local | fixed_offset
    utc_offset_minutes: int | None = None
    start_rule: str = "exact"  # exact | after_update | unknown
    official_url: str | None = None
    task_preset_key: str | None = None
    raw_text: str | None = None
    trusted: bool = False  # the parser matched the expected pattern exactly


@dataclass
class Article:
    """One official article and what was read from it."""

    external_id: str
    title: str
    url: str | None = None
    article_kind: str = "other"
    published_at: str | None = None  # ISO time with an offset
    content_hash: str | None = None
    # True only when the article was fetched and parsed in full (see the ingest README).
    complete: bool = False
    # The version this article announces and when it goes live (the end of the update maintenance):
    # {"version": "1.5", "released_at": "2026-11-11T11:00:00+08:00"}. Gives "after update" events a start.
    version_release: dict | None = None
    observations: list[Observation] = field(default_factory=list)
    # Lines that looked like a date but could not be read. Never sent; shown in the run report.
    problems: list[str] = field(default_factory=list)

    def to_payload(self) -> dict:
        data = asdict(self)
        data.pop("problems")
        return data


def build_payload(source: str, game: str, articles: list[Article]) -> dict:
    return {"source": source, "game": game, "articles": [a.to_payload() for a in articles]}
