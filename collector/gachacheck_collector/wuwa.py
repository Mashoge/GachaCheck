"""Wuthering Waves adapter.

Source: the official website's own data files (the same ones the news page loads).
  - ArticleMenu.json  : every article, with id, title, created and publish time
  - article/<id>.json : one article; its body is HTML in "articleContent"

What is read today: the Patch Notes of each version. They list the version's events with
their dates as text, and the end of the current Endstate Matrix cycle.

Rules learned from the real files (versions 3.7 and 3.8):
  - The article-level startTime/endTime are publish times, never event dates.
  - An event is a line "[Name] <Type> Event" followed by a line containing "Duration".
    The duration is written four ways ("✦Duration:", "✦Duration✦", with the date on the same
    or the next line, or "✦Event Duration✦"), so the reader is tolerant.
  - "Permanently available" items are not events.
  - Times are copied exactly as printed. "(server time)" means each server's own clock;
    "(UTC+8)" is a fixed clock.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timedelta, timezone

import httpx
from bs4 import BeautifulSoup

from .models import Article, Observation

SOURCE = "wuwa_official_site"
GAME = "wuwa"
BASE_URL = "https://hw-media-cdn-mingchao.kurogame.com/akiwebsite/website2.0/json/G152/en"
ARTICLE_PAGE = "https://wutheringwaves.kurogames.com/en/main/news/detail/{id}"
USER_AGENT = "GachaCheckCollector/0.1 (personal event tracker; one request per article per day)"

UTC8 = timezone(timedelta(hours=8))  # the site's own times (publish times) are UTC+8
LOOKBACK_DAYS = 60  # one version lasts about six weeks

PATCH_NOTES_TITLE = re.compile(r"\bPatch Notes\b", re.I)
VERSION = re.compile(r"\bVersion\s+(\d+\.\d+)", re.I)

DATE = r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}"
# "[Name] Leisure Event", "[Special Events] [Name] Leisure Event", "[Name] Web Event"
EVENT_HEADER = re.compile(r"\[(?P<name>[^\[\]]+)\]\s*(?P<type>[^\[\]]*\bEvent)\s*$")
# "2026-11-19 04:00 - 2026-12-03 03:59 (server time)" or "Version 3.8 Update - 2026-12-21 03:59 (server time)"
DURATION_VALUE = re.compile(
    rf"(?P<start>{DATE}|(?:After\s+the\s+)?Version\s+[\d.]+\s+update)\s*[-–~]\s*(?P<end>{DATE})\s*"
    r"\(\s*(?P<basis>server\s*time|UTC\s*\+\s*8)\s*\)",
    re.I,
)
MAINTENANCE = re.compile(rf"Maintenance Time:\s*({DATE})\s*[-–~]\s*({DATE})\s*\(\s*UTC\s*\+\s*8\s*\)", re.I)
# "✦Second Endstate Matrix Cycle - Adversity Vanguard ends at: 2026-12-22 03:59 (UTC+8)"
ENDSTATE_END = re.compile(rf"(?P<label>[^✦]*Endstate Matrix[^✦]*?)\s+ends at:\s*(?P<end>{DATE})\s*\(\s*UTC\s*\+\s*8\s*\)", re.I)

# How many lines after an event's header its duration may appear (description lines sit between)
MAX_LINES_TO_DURATION = 6


# ---------- small helpers ----------

def slug(text: str) -> str:
    """'Lahai-Roi Blocks: Turnabout' -> 'lahai-roi-blocks-turnabout'"""
    return re.sub(r"[^a-z0-9]+", "-", text.lower().replace("'", "").replace("’", "")).strip("-")


def iso_minute(printed: str) -> str:
    """'2026-11-19 04:00' -> '2026-11-19T04:00' (same clock time, only the separator changes)"""
    return printed.strip().replace(" ", "T")


def text_lines(html: str) -> list[str]:
    """The article body as plain lines, one per innermost <div>, in reading order."""
    soup = BeautifulSoup(html, "html.parser")
    blocks = [d for d in soup.find_all("div") if d.find("div") is None] or [soup]
    lines = []
    for block in blocks:
        line = re.sub(r"\s+", " ", block.get_text(" ").replace("\xa0", " ")).strip()
        if line:
            lines.append(line)
    return lines


def published_iso(site_time: str | None) -> str | None:
    """The site's 'YYYY-MM-DD HH:MM:SS' (UTC+8) as an ISO time with its offset."""
    if not site_time:
        return None
    try:
        return datetime.strptime(site_time, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC8).isoformat()
    except ValueError:
        return None


# ---------- parsing (no network; this is what the tests cover) ----------

def is_patch_notes(title: str) -> bool:
    return bool(PATCH_NOTES_TITLE.search(title) and VERSION.search(title))


def parse_patch_notes(article_json: dict, content_hash: str | None = None) -> Article:
    """Reads one Patch Notes article into an Article with its observations."""
    article_id = str(article_json["articleId"])
    title = str(article_json.get("articleTitle", "")).strip()
    url = ARTICLE_PAGE.format(id=article_id)
    article = Article(
        external_id=article_id,
        title=title,
        url=url,
        article_kind="patch_notes",
        published_at=published_iso(article_json.get("startTime")),
        content_hash=content_hash,
    )

    version_match = VERSION.search(title)
    version = version_match.group(1) if version_match else ""
    lines = text_lines(str(article_json.get("articleContent", "")))
    if not version or not lines:
        article.problems.append("No version in the title, or the article body is empty.")
        return article

    # When the update finishes (a fixed UTC+8 time). Used for "Version X Update" starts.
    update_end = None
    for line in lines:
        m = MAINTENANCE.search(line)
        if m:
            update_end = iso_minute(m.group(2))
            break

    seen: set[str] = set()

    def add(obs: Observation) -> None:
        if obs.observed_key not in seen:  # an article reports each item once
            seen.add(obs.observed_key)
            article.observations.append(obs)

    for i, line in enumerate(lines):
        # ---- the Endstate Matrix cycle that ends with this version ----
        end_match = ENDSTATE_END.search(line)
        if end_match:
            label = end_match.group("label").strip(" ✦-")
            cycle = label.split(" - ", 1)[1] if " - " in label else label
            add(Observation(
                observed_key=f"endgame:endstate:{slug(cycle)}",
                kind="endgame_cycle",
                name="Endstate Matrix",
                version=version,
                occurrence_key=slug(cycle)[:40],
                ends_local=iso_minute(end_match.group("end")),
                time_basis="fixed_offset",
                utc_offset_minutes=480,
                start_rule="unknown",
                task_preset_key="endstate",
                official_url=url,
                raw_text=line[:500],
                trusted=True,
            ))
            continue

        # ---- an event: its header, then a duration within the next few lines ----
        header = EVENT_HEADER.search(line)
        if not header:
            continue
        name = header.group("name").strip()
        kind = "web_event" if re.search(r"\bWeb Event\b", header.group("type"), re.I) else "event"

        duration_text = None
        for j in range(i + 1, min(i + 1 + MAX_LINES_TO_DURATION, len(lines))):
            if EVENT_HEADER.search(lines[j]):
                break  # the next event started; this one has no duration
            if "duration" in lines[j].lower():
                # the value is on the same line, or alone on the next one
                nxt = lines[j + 1] if j + 1 < len(lines) else ""
                duration_text = lines[j] if re.search(r"\d{4}|permanent", lines[j], re.I) else f"{lines[j]} {nxt}"
                break

        if duration_text is None:
            article.problems.append(f"No duration found for: {line[:120]}")
            continue
        if re.search(r"permanent", duration_text, re.I):
            continue  # permanent content is not an event

        value = DURATION_VALUE.search(duration_text)
        if not value:
            article.problems.append(f"Could not read the dates in: {duration_text[:160]}")
            continue

        fixed = "utc" in value.group("basis").lower()
        start_text = value.group("start")
        if re.match(r"\d{4}", start_text):
            starts_local, start_rule = iso_minute(start_text), "exact"
        elif fixed and update_end:
            # "after the update" on a fixed UTC+8 clock: the maintenance end is that moment
            starts_local, start_rule = update_end, "after_update"
        else:
            # "after the update" in server time: the update is one moment worldwide, so it is a
            # different clock time on each server. Left empty rather than guessed.
            starts_local, start_rule = None, "after_update"

        add(Observation(
            observed_key=f"{kind}:{slug(name)}",
            kind=kind,
            name=name,
            version=version,
            starts_local=starts_local,
            ends_local=iso_minute(value.group("end")),
            time_basis="fixed_offset" if fixed else "server_local",
            utc_offset_minutes=480 if fixed else None,
            start_rule=start_rule,
            official_url=url if kind == "web_event" else None,
            raw_text=duration_text[:500],
            trusted=True,
        ))

    # Complete = the whole article was read and every dated item became an observation.
    article.complete = not article.problems and bool(article.observations)
    return article


# ---------- network ----------

def select_patch_notes(menu: list[dict], now: datetime | None = None) -> list[dict]:
    """Patch Notes published in the last LOOKBACK_DAYS, newest first.

    Chosen by title and publish time. The position in the index is never used:
    pinned articles come first there, whatever their age.
    """
    now = now or datetime.now(timezone.utc)
    chosen = []
    for item in menu:
        title = str(item.get("articleTitle", ""))
        published = published_iso(item.get("startTime"))
        if not item.get("articleId") or not published or not is_patch_notes(title):
            continue
        age = now - datetime.fromisoformat(published)
        if timedelta(0) <= age <= timedelta(days=LOOKBACK_DAYS):
            chosen.append(item)
    return sorted(chosen, key=lambda a: a["startTime"], reverse=True)


def collect(client: httpx.Client | None = None, now: datetime | None = None) -> list[Article]:
    """Fetches the index and the current Patch Notes, and parses them."""
    own_client = client is None
    client = client or httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT})
    try:
        stamp = int(time.time() * 1000)  # the site's own cache-buster
        menu_response = client.get(f"{BASE_URL}/ArticleMenu.json", params={"t": stamp})
        menu_response.raise_for_status()
        menu = menu_response.json()
        if not isinstance(menu, list):
            raise ValueError("The article index is not a list; the site's format may have changed.")

        articles = []
        for item in select_patch_notes(menu, now):
            response = client.get(f"{BASE_URL}/article/{item['articleId']}.json", params={"t": stamp})
            response.raise_for_status()
            body = response.content
            # Same value as the file's ETag: a new hash means the publisher edited the article
            content_hash = hashlib.md5(body).hexdigest().upper()
            articles.append(parse_patch_notes(json.loads(body), content_hash))
        return articles
    finally:
        if own_client:
            client.close()
