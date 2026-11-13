"""Tests for the Wuthering Waves adapter. They run on saved copies of the real official files."""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx

from gachacheck_collector import wuwa
from gachacheck_collector.models import build_payload

FIXTURES = Path(__file__).parent / "fixtures" / "wuwa"
NOW = datetime(2026, 11, 13, 3, 0, tzinfo=timezone.utc)


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8-sig"))


def by_name(article):
    return {o.name: o for o in article.observations}


# ---------- Patch Notes 3.8 ----------

def test_patch_notes_3_8_events():
    article = wuwa.parse_patch_notes(load("article_5783.json"))
    events = by_name(article)

    assert article.external_id == "5783"
    assert article.article_kind == "patch_notes"
    assert article.published_at == "2026-11-12T10:00:00+08:00"
    assert article.url == "https://wutheringwaves.kurogames.com/en/main/news/detail/5783"
    assert article.problems == []
    assert article.complete is True

    assert sorted(n for n, o in events.items() if o.kind == "event") == [
        "Dreamfield Odyssey",
        "Gifts of Bygone Dreams",
        "Lahai-Roi Blocks: Turnabout",
        "Lollo Campaign: Groundwork",
        "Second Coming of Solaris: Unwritten Dreams",
        "Whither the Wind",
    ]

    blocks = events["Lahai-Roi Blocks: Turnabout"]
    assert (blocks.starts_local, blocks.ends_local) == ("2026-11-19T04:00", "2026-12-03T03:59")
    assert (blocks.time_basis, blocks.utc_offset_minutes, blocks.start_rule) == ("server_local", None, "exact")
    assert (blocks.version, blocks.trusted, blocks.observed_key) == ("3.8", True, "event:lahai-roi-blocks-turnabout")


def test_duration_written_with_a_second_star_is_read():
    # "✦Duration✦ Version 3.8 Update - 2026-12-21 03:59 (server time)"
    gifts = by_name(wuwa.parse_patch_notes(load("article_5783.json")))["Gifts of Bygone Dreams"]
    assert gifts.ends_local == "2026-12-21T03:59"


def test_update_start_in_server_time_is_left_empty():
    # The update is one moment worldwide, so its clock time differs per server: not guessed
    dreams = by_name(wuwa.parse_patch_notes(load("article_5783.json")))["Second Coming of Solaris: Unwritten Dreams"]
    assert (dreams.starts_local, dreams.start_rule) == (None, "after_update")
    assert dreams.ends_local == "2026-12-21T11:59"


def test_endstate_matrix_cycle_end():
    cycle = by_name(wuwa.parse_patch_notes(load("article_5783.json")))["Endstate Matrix"]
    assert cycle.kind == "endgame_cycle"
    assert cycle.task_preset_key == "endstate"
    assert cycle.occurrence_key == "adversity-vanguard"
    assert cycle.ends_local == "2026-12-22T03:59"
    assert (cycle.time_basis, cycle.utc_offset_minutes) == ("fixed_offset", 480)
    assert (cycle.starts_local, cycle.start_rule) == (None, "unknown")


def test_article_level_times_are_never_event_dates():
    raw = load("article_5783.json")
    article = wuwa.parse_patch_notes(raw)
    forbidden = {raw["startTime"][:10], raw["endTime"][:10]}  # publish day and the year-2099 placeholder
    for o in article.observations:
        assert (o.ends_local or "")[:10] not in forbidden
        assert (o.starts_local or "")[:10] not in forbidden


# ---------- Patch Notes 3.7 (same layout, more groups) ----------

def test_patch_notes_3_7_events_and_web_events():
    article = wuwa.parse_patch_notes(load("article_5571.json"))
    events = by_name(article)

    assert article.problems == []
    assert article.complete is True
    assert {o.version for o in article.observations} == {"3.7"}
    assert len([o for o in article.observations if o.kind == "event"]) == 7
    assert sorted(n for n, o in events.items() if o.kind == "web_event") == ["Back to Solaris", "Waking Moon Fishing"]

    # "[Special Events] [Cubie Wars] Leisure Event": the section label shares the line
    assert "Cubie Wars" in events and "Special Events" not in events


def test_web_event_uses_the_fixed_utc8_clock_and_keeps_a_link():
    events = by_name(wuwa.parse_patch_notes(load("article_5571.json")))
    fishing = events["Waking Moon Fishing"]
    assert (fishing.time_basis, fishing.utc_offset_minutes) == ("fixed_offset", 480)
    assert (fishing.starts_local, fishing.ends_local) == ("2026-10-15T10:00", "2026-11-01T09:59")
    assert fishing.official_url == "https://wutheringwaves.kurogames.com/en/main/news/detail/5571"

    # "Version 3.7 Update" on a fixed clock: the maintenance end (11:00 UTC+8) is that moment
    back = events["Back to Solaris"]
    assert (back.starts_local, back.start_rule) == ("2026-09-30T11:00", "after_update")


def test_permanent_content_is_not_an_event():
    events = by_name(wuwa.parse_patch_notes(load("article_5571.json")))
    assert "Past Dreams, Traced Seals" not in events  # "Photo Collection Event", permanently available
    assert "Blooms for the Shadow" not in events


# ---------- things that must not be trusted ----------

def test_unreadable_dates_are_reported_and_the_article_is_not_complete():
    raw = load("article_5783.json")
    raw["articleContent"] = raw["articleContent"].replace(
        "2026-11-19 04:00 - 2026-12-03 03:59 (server time)", "from Thursday until the week after next")
    article = wuwa.parse_patch_notes(raw)
    assert article.complete is False
    assert any("Could not read the dates" in p for p in article.problems)
    assert "Lahai-Roi Blocks: Turnabout" not in by_name(article)
    assert "Whither the Wind" in by_name(article)  # the rest is still read


def test_an_event_with_no_duration_is_reported():
    raw = load("article_5783.json")
    raw["articleContent"] = raw["articleContent"].replace("✦Duration: 2026-12-07 04:00 - 2026-12-21 03:59 (server time)", "")
    article = wuwa.parse_patch_notes(raw)
    assert article.complete is False
    assert any("No duration found" in p and "Whither the Wind" in p for p in article.problems)


def test_an_empty_or_image_only_article_is_not_complete():
    notice = load("article_5653.json")  # "Upcoming Events in Version 3.7": two images, no dates in text
    assert wuwa.is_patch_notes(notice["articleTitle"]) is False
    article = wuwa.parse_patch_notes(notice)
    assert article.observations == []
    assert article.complete is False


def test_an_event_listed_twice_is_sent_once():
    raw = load("article_5783.json")
    raw["articleContent"] += raw["articleContent"]
    article = wuwa.parse_patch_notes(raw)
    names = [o.name for o in article.observations]
    assert len(names) == len(set(names)) == 7


# ---------- discovery ----------

def test_patch_notes_are_chosen_by_title_and_publish_time_not_position():
    menu = load("ArticleMenu.json")
    assert [a["articleId"] for a in menu[:2]] == [1858, 758]  # two old pinned articles come first
    chosen = wuwa.select_patch_notes(menu, NOW)
    assert [a["articleId"] for a in chosen] == [5783, 5571]  # newest first; 3.7 is still inside 60 days


def test_old_and_not_yet_published_patch_notes_are_left_out():
    menu = [
        {"articleId": 1, "articleTitle": "Patch Notes for Version 1.0", "startTime": "2026-08-01 10:00:00"},
        {"articleId": 2, "articleTitle": "Patch Notes for Version 9.9", "startTime": "2026-12-25 10:00:00"},
        {"articleId": 3, "articleTitle": "Patch Notes for Version 3.8", "startTime": "not a time"},
        {"articleId": 4, "articleTitle": "Upcoming Events in Wuthering Waves Version 3.7", "startTime": "2026-11-01 10:00:00"},
    ]
    assert wuwa.select_patch_notes(menu, NOW) == []


def test_title_patterns_from_several_years():
    assert wuwa.is_patch_notes("Patch Notes for Version 3.8: Lilies in a Dying Dream")
    assert wuwa.is_patch_notes("Patch Notes for Wuthering Waves Version 3.7: Prism's Illusion")
    assert wuwa.is_patch_notes("Version 2.3: Fiery Arpeggio of Summer Reunion Patch Notes")
    assert not wuwa.is_patch_notes("Wuthering Waves Version 3.8 Update Maintenance Notice")
    assert not wuwa.is_patch_notes("V3.8 Wuthering Waves Battle Rush")


# ---------- the whole run, with the network replaced by the saved files ----------

def fake_site(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/ArticleMenu.json"):
        return httpx.Response(200, content=(FIXTURES / "ArticleMenu.json").read_bytes())
    name = f"article_{path.rsplit('/', 1)[1]}"
    file = FIXTURES / name
    return httpx.Response(200, content=file.read_bytes()) if file.exists() else httpx.Response(404)


def test_collect_builds_a_payload_the_ingest_function_accepts():
    with httpx.Client(transport=httpx.MockTransport(fake_site)) as client:
        articles = wuwa.collect(client, NOW)

    assert [a.external_id for a in articles] == ["5783", "5571"]
    expected_hash = hashlib.md5((FIXTURES / "article_5783.json").read_bytes()).hexdigest().upper()
    assert articles[0].content_hash == expected_hash  # the same value as the file's ETag

    payload = build_payload(wuwa.SOURCE, wuwa.GAME, articles)
    assert payload["source"] == "wuwa_official_site" and payload["game"] == "wuwa"
    first = payload["articles"][0]
    assert "problems" not in first  # internal notes are never sent
    assert first["complete"] is True and len(first["observations"]) == 7
    keys = [o["observed_key"] for o in first["observations"]]
    assert len(keys) == len(set(keys))  # the ingest function refuses repeats inside an article
    json.dumps(payload)  # everything is plain JSON


def test_a_failing_site_raises_instead_of_sending_half_a_run():
    def down(request):
        return httpx.Response(503)

    with httpx.Client(transport=httpx.MockTransport(down)) as client:
        try:
            wuwa.collect(client, NOW)
        except httpx.HTTPStatusError:
            pass
        else:
            raise AssertionError("expected an error when the site is down")


def test_the_version_goes_live_when_maintenance_ends():
    assert wuwa.parse_patch_notes(load("article_5783.json")).version_release == {
        "version": "3.8", "released_at": "2026-11-12T11:00:00+08:00"}
    assert wuwa.parse_patch_notes(load("article_5571.json")).version_release == {
        "version": "3.7", "released_at": "2026-09-30T11:00:00+08:00"}
