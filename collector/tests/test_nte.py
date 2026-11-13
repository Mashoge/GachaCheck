"""Tests for the NTE adapter. They run on saved copies of the real official pages."""

import json
from datetime import date, datetime, timezone
from pathlib import Path

import httpx

from gachacheck_collector import nte
from gachacheck_collector.models import build_payload

FIXTURES = Path(__file__).parent / "fixtures" / "nte"
NOW = datetime(2026, 11, 13, 3, 0, tzinfo=timezone.utc)
URL_15 = "https://nte.perfectworld.com/en/article/news/gamenews/20261109/264948.html"
URL_14 = "https://nte.perfectworld.com/en/article/news/gamenews/20260929/264409.html"


def page(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def notes_15():
    return nte.parse_patch_notes(page("article_264948.html"), URL_15, "264948")


def notes_14():
    return nte.parse_patch_notes(page("article_264409.html"), URL_14, "264409")


def by_name(article):
    return {o.name: o for o in article.observations}


def synthetic(details: str, maintenance: bool = True) -> str:
    """A minimal patch-notes page in the site's layout, for edge cases."""
    window = "● Maintenance Period: Dec 30, 2026, 06:00 – 11:00 (UTC+8)<br/>" if maintenance else ""
    return (
        '<h1 class="abs articleTitle">Version 9.9 Test Patch Notes</h1><p class="articleDate">2026.12.28</p>'
        f'<div class="articleContent"><p>Hey Appraiser,<br/>[Maintenance &amp; Compensation]<br/>{window}'
        f"[Update Details]<br/>{details}<br/>[Optimizations &amp; Bug Fixes]<br/>◆ Fix other known issues.</p></div>"
    )


# ---------- Version 1.5 ----------

def test_patch_notes_1_5_events():
    article = notes_15()
    assert article.external_id == "264948"
    assert article.title == "Version 1.5 [Once Upon a Glitched Call] Patch Notes"
    assert article.article_kind == "patch_notes"
    assert article.published_at == "2026-11-09T00:00:00+08:00"
    assert article.problems == []
    assert article.complete is True
    assert sorted(by_name(article)) == [
        "Circle Bounty", "Circle Gifts", "City Logistics", "Fishing Frenzy", "Fortune's Bounty",
        "Full Tank Ahead", "Gold Clash", "Hunter's Crucible: Breakthrough", "Open Roads Ahead Mystery Box",
        "Pixel Surge",
    ]
    assert {o.version for o in article.observations} == {"1.5"}


def test_the_version_goes_live_when_maintenance_ends():
    assert notes_15().version_release == {"version": "1.5", "released_at": "2026-11-11T11:00:00+08:00"}
    # 1.4 calls it "Maintenance Window" and spells the month out
    assert notes_14().version_release == {"version": "1.4", "released_at": "2026-09-30T11:00:00+08:00"}


def test_after_update_starts():
    events = by_name(notes_15())
    # On the fixed UTC+8 clock the maintenance end is that moment
    circle = events["Circle Gifts"]
    assert (circle.start_rule, circle.starts_local, circle.ends_local) == ("after_update", "2026-11-11T11:00", "2026-12-23T05:59")
    assert (circle.time_basis, circle.utc_offset_minutes) == ("fixed_offset", 480)
    # In server time it is a different clock time on each server: left empty, the version date fills it
    fortune = events["Fortune's Bounty"]
    assert (fortune.start_rule, fortune.starts_local, fortune.time_basis) == ("after_update", None, "server_local")


def test_exact_dates_in_both_clocks():
    events = by_name(notes_15())
    tank = events["Full Tank Ahead"]
    assert (tank.start_rule, tank.starts_local, tank.ends_local, tank.utc_offset_minutes) == ("exact", "2026-11-19T10:00", "2026-12-23T05:59", 480)
    gold = events["Gold Clash"]
    assert (gold.starts_local, gold.ends_local, gold.time_basis, gold.utc_offset_minutes) == ("2026-11-23T05:00", "2026-12-07T04:59", "server_local", None)


def test_mystery_box_named_in_its_section_heading():
    box = by_name(notes_15())["Open Roads Ahead Mystery Box"]
    assert box.kind == "event" and box.ends_local == "2026-12-23T05:59"


# ---------- Version 1.4 ----------

def test_patch_notes_1_4_events_and_web_event():
    article = notes_14()
    assert article.problems == [] and article.complete is True
    events = by_name(article)
    assert sorted(events) == [
        "Blackbird's Invitation", "Born to Race Mystery Box", "Circle Bounty", "Circle Gifts",
        "Coal Lump's Treasure", "Everdriving Mystery Box", "Pixel Surge", "Pukaland Travelogue",
        "Stamina Recharge", "Terminal Depths",
    ]
    web = events["Blackbird's Invitation"]
    assert web.kind == "web_event" and web.observed_key == "web_event:blackbirds-invitation"
    assert web.official_url == URL_14
    assert (web.starts_local, web.ends_local, web.utc_offset_minutes) == ("2026-09-30T11:00", "2026-11-11T05:59", 480)


def test_banners_outfits_and_permanent_content_are_not_events():
    # 1.4 labels banners "Available:" just like events, so the section decides
    names = " ".join(by_name(notes_14()))
    for left_out in ("Blackbird", "Lacrimosa", "Crime and Punishment", "Last Rose", "Wandering Stars", "Witch", "Pukaland Gold", "Puka Membership", "Porsche Club"):
        assert left_out not in names.replace("Blackbird's Invitation", "")
    names_15 = " ".join(by_name(notes_15()))
    for left_out in ("Elyms", "Shinku", "Echoes on Hold", "Y2K", "Amber Broodmother", "Data Stream"):
        assert left_out not in names_15


def test_keys_are_unique_and_only_web_events_carry_a_link():
    for article in (notes_15(), notes_14()):
        keys = [o.observed_key for o in article.observations]
        assert len(keys) == len(set(keys))
        assert all((o.official_url is not None) == (o.kind == "web_event") for o in article.observations)
        assert all(o.trusted for o in article.observations)


def test_content_hash_follows_the_text_not_the_page_around_it():
    html = page("article_264948.html")
    same = nte.parse_patch_notes(html.replace("</body>", "<footer>new footer</footer></body>"), URL_15, "264948")
    edited = nte.parse_patch_notes(html.replace("Dec 23, 05:59 (UTC+8)", "Dec 24, 05:59 (UTC+8)", 1), URL_15, "264948")
    assert same.content_hash == notes_15().content_hash
    assert edited.content_hash != notes_15().content_hash


# ---------- rules ----------

def test_year_comes_from_the_post_date():
    assert nte.year_for(11, 11, date(2026, 11, 9)) == 2026
    assert nte.year_for(1, 5, date(2026, 12, 28)) == 2027  # December notes, January dates
    assert nte.year_for(12, 30, date(2027, 1, 3)) == 2026


def test_dates_across_new_year():
    article = nte.parse_patch_notes(synthetic(
        '6. New Events<br/>● "Snow Day" Limited-Time Event<br/>Duration: Dec 30 (after update) – Jan 20, 05:59 (server time)'
    ), "https://nte.perfectworld.com/en/article/news/gamenews/20261228/1.html", "1")
    snow = by_name(article)["Snow Day"]
    assert snow.ends_local == "2027-01-20T05:59"
    assert article.version_release == {"version": "9.9", "released_at": "2026-12-30T11:00:00+08:00"}
    assert article.complete is True


def test_names():
    assert nte.name_of('● "City Logistics" Limited-Time Event') == ("City Logistics", "event")
    assert nte.name_of('● New Mystery Box Event: "Born to Race"') == ("Born to Race Mystery Box", "event")
    assert nte.name_of('● "Blackbird\'s Invitation" Web Event') == ("Blackbird's Invitation", "web_event")
    assert nte.name_of("● Version 1.4 「Circle Bounty」 Guide") == ("Circle Bounty", "event")
    assert nte.name_of("● Spring Festival Limited-Time Event") == ("Spring Festival", "event")


def test_unreadable_dates_are_reported_and_the_article_is_not_complete():
    article = nte.parse_patch_notes(synthetic(
        '6. New Events<br/>● "Good One" Limited-Time Event<br/>Duration: Dec 30, 10:00 – Jan 10, 05:59 (UTC+8)'
        '<br/>● "Broken One" Limited-Time Event<br/>Duration: Dec 30 – sometime in January (UTC+8)'
        '<br/>● "Odd Clock" Limited-Time Event<br/>Duration: Dec 30, 10:00 – Jan 10, 05:59 (Pacific)'
    ), "https://x.example/2026/1.html", "1")
    assert list(by_name(article)) == ["Good One"]
    assert len(article.problems) == 2
    assert article.complete is False


def test_missing_sections_are_reported():
    no_details = nte.parse_patch_notes(synthetic("x").replace("[Update Details]", "[Something Else]"), "https://x.example/1.html", "1")
    assert no_details.complete is False and any("Update Details" in p for p in no_details.problems)

    no_window = nte.parse_patch_notes(synthetic(
        '6. New Events<br/>● "Fine" Limited-Time Event<br/>Duration: Dec 30, 10:00 – Jan 10, 05:59 (UTC+8)', maintenance=False
    ), "https://x.example/1.html", "1")
    assert no_window.version_release is None
    assert [o.name for o in no_window.observations] == ["Fine"]  # events still read
    assert no_window.complete is False  # but the run is flagged


def test_the_same_name_twice_in_one_version_is_kept_apart():
    article = nte.parse_patch_notes(synthetic(
        '6. New Events<br/>● "Pixel Surge" Limited-Time Event<br/>Duration: Dec 30, 05:00 – Jan 6, 04:59 (server time)'
        '<br/>● "Pixel Surge" Limited-Time Event<br/>Duration: Jan 13, 05:00 – Jan 20, 04:59 (server time)'
    ), "https://x.example/1.html", "1")
    keys = [(o.observed_key, o.occurrence_key) for o in article.observations]
    assert keys == [("event:pixel-surge", ""), ("event:pixel-surge:2027-01-20", "2027-01-20")]


# ---------- index and network ----------

def test_index_entries():
    entries = nte.parse_index(page("index.html"))
    assert [e.external_id for e in entries] == ["265030", "264948", "264938"]
    notes = entries[1]
    assert notes.title == "Version 1.5 [Once Upon a Glitched Call] Patch Notes"
    assert notes.url == URL_15 and notes.posted == date(2026, 11, 9)
    assert [nte.is_patch_notes(e.title) for e in entries] == [False, True, False]
    assert nte.is_patch_notes("Ver. 1.4 「For Whom the Verses Mourn」 Patch Notes")


def fake_site(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    files = {
        "/en/article/news/index.html": "index.html",
        "/en/article/news/index1.html": "index1.html",
        "/en/article/news/index2.html": "index2.html",
        "/en/article/news/index3.html": "index3.html",
        "/en/article/news/gamenews/20261109/264948.html": "article_264948.html",
        "/en/article/news/gamenews/20260929/264409.html": "article_264409.html",
    }
    if path in files:
        return httpx.Response(200, text=page(files[path]))
    return httpx.Response(404)


def test_collect_builds_a_payload_the_ingest_function_accepts():
    with httpx.Client(transport=httpx.MockTransport(fake_site)) as client:
        articles = nte.collect(client, NOW)
    assert [a.external_id for a in articles] == ["264948", "264409"]

    payload = build_payload(nte.SOURCE, nte.GAME, articles)
    assert payload["source"] == "nte_official_site" and payload["game"] == "nte"
    first = payload["articles"][0]
    assert "problems" not in first
    assert first["version_release"] == {"version": "1.5", "released_at": "2026-11-11T11:00:00+08:00"}
    assert first["complete"] is True and len(first["observations"]) == 10
    json.dumps(payload)


def test_old_patch_notes_are_left_out():
    later = datetime(2026, 12, 1, 3, 0, tzinfo=timezone.utc)  # 1.4 is now more than 60 days old
    with httpx.Client(transport=httpx.MockTransport(fake_site)) as client:
        articles = nte.collect(client, later)
    assert [a.external_id for a in articles] == ["264948"]


def test_a_failing_site_raises_instead_of_sending_half_a_run():
    def down(request):
        return httpx.Response(503)

    with httpx.Client(transport=httpx.MockTransport(down)) as client:
        try:
            nte.collect(client, NOW)
        except httpx.HTTPStatusError:
            pass
        else:
            raise AssertionError("expected an error when the site is down")
