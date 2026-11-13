"""Neverness to Everness (NTE) adapter.

Source: the official English news pages, plain HTML.
  - news index : /en/article/news/index.html, then index1.html, index2.html, ... (3 articles a page)
  - an article : /en/article/news/<category>/<YYYYMMDD>/<id>.html

What is read today: the patch notes of each version. They list the version's limited-time
events with their dates as text, and the update maintenance window.

Rules learned from the real pages (versions 1.4 and 1.5):
  - The pages send no ETag or Last-Modified, so the collector hashes the article text itself.
  - Event dates have no year ("Nov 11", "September 30"). The year comes from the post date.
  - An entry is a "●" line (the name usually in quotes), then a date line labelled
    "Duration:", "Event Duration:", "Available:" or "Availability:". The label alone does not tell
    events from banners (1.4 writes "Available:" for both), so the section decides:
    sections about characters, arcs, story, stages, locations and outfits are skipped.
  - A date line without a range ("Available: After the Version 1.5 update") is permanent content.
  - Times end with "(UTC+8)" (a fixed clock) or "(server time)" (each server's own clock).
  - "Nov 11 (after update)" starts when the update maintenance ends. That moment is sent once per
    version (version_release); the events view uses it for every "after update" start.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import httpx
from bs4 import BeautifulSoup

from .models import Article, Observation

SOURCE = "nte_official_site"
GAME = "nte"
SITE = "https://nte.perfectworld.com"
USER_AGENT = "GachaCheckCollector/0.1 (personal event tracker; a few requests a day)"

LOOKBACK_DAYS = 60  # one version lasts about six weeks
MAX_INDEX_PAGES = 10  # 3 articles a page; the current patch notes are always within the first few

PATCH_NOTES_TITLE = re.compile(r"\bPatch Notes\b", re.I)
VERSION = re.compile(r"\b(?:Version|Ver\.?)\s*(\d+\.\d+)", re.I)
ARTICLE_HREF = re.compile(r"^/en/article/news/[a-z]+/(?P<day>\d{8})/(?P<id>\d+)\.html$")

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
MONTH = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?"
DASH = r"\s*[–—\-~]\s*"


def _point(p: str) -> str:
    """'Nov 11', 'Nov 11, 2026', 'Nov 11 (after update)', 'Nov 19, 10:00', 'September 30, 2026, 06:00'"""
    return (
        rf"(?P<{p}_month>{MONTH})\s+(?P<{p}_day>\d{{1,2}})(?:,\s*(?P<{p}_year>\d{{4}}))?"
        rf"(?P<{p}_after>\s*\(\s*after\s+(?:the\s+)?update\s*\))?"
        rf"(?:,?\s*(?P<{p}_time>\d{{1,2}}:\d{{2}}))?"
    )


RANGE = re.compile(rf"^{_point('s')}{DASH}{_point('e')}\s*\(\s*(?P<tz>[^)]+?)\s*\)\s*$", re.I)
DATE_LINE = re.compile(r"^(?P<label>Duration|Event Duration|Available|Availability)\s*:\s*(?P<value>.+)$", re.I)
# "● Maintenance Period: Nov 11, 2026, 06:00 – 11:00 (UTC+8)" (1.4 writes "Maintenance Window")
MAINTENANCE = re.compile(
    rf"Maintenance (?:Period|Window|Time)\s*:\s*{_point('m')}{DASH}(?P<until>\d{{1,2}}:\d{{2}})\s*\(\s*UTC\s*(?P<off>[+-]\s*\d{{1,2}})\s*\)",
    re.I,
)
SECTION = re.compile(r"^\d+\.\s+\S")
SKIPPED_SECTION = re.compile(r"Character|\bArcs?\b|Story|Stages?\b|Locations?\b|Outfits?|Accessor", re.I)
QUOTED = re.compile(r"[\"“”]([^\"“”]+)[\"“”]|「([^」]+)」|『([^』]+)』")

MAX_LINES_TO_DATE = 8  # description lines can sit between an entry's name and its date line


# ---------- small helpers ----------

def slug(text: str) -> str:
    """'Hunter's Crucible: Breakthrough' -> 'hunters-crucible-breakthrough'"""
    return re.sub(r"[^a-z0-9]+", "-", text.lower().replace("'", "").replace("’", "")).strip("-")


def text_lines(html: str) -> list[str]:
    """The article body as plain lines: one per <br> or block element, inline tags kept whole."""
    soup = BeautifulSoup(html, "html.parser")
    for br in soup.find_all("br"):
        br.replace_with("\n")
    for block in soup.find_all(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr"]):
        block.append("\n")
    lines = []
    for raw in soup.get_text("").split("\n"):
        line = re.sub(r"\s+", " ", raw.replace("\xa0", " ")).strip()
        if line:
            lines.append(line)
    return lines


def year_for(month: int, day: int, posted: date) -> int:
    """Event dates have no year. Pick the one that puts the date nearest the post date,
    so a December post's "Jan 5" lands in the next year."""
    best = posted.year
    for y in (posted.year - 1, posted.year, posted.year + 1):
        try:
            if abs((date(y, month, day) - posted).days) < abs((date(best, month, day) - posted).days):
                best = y
        except ValueError:  # Feb 29 in a non-leap year
            continue
    return best


def name_of(line: str) -> tuple[str, str]:
    """('City Logistics', 'event') from '● "City Logistics" Limited-Time Event'."""
    text = line.lstrip("●•· ").strip()
    kind = "web_event" if re.search(r"\bWeb Event\b", text, re.I) else "event"
    quoted = QUOTED.search(text)
    if quoted:
        name = next(g for g in quoted.groups() if g)
    else:
        name = re.sub(r"^\d+\.\s*", "", text)
        name = re.sub(r"\s*(Limited-Time |Login |Web )?Event\s*$", "", name, flags=re.I)
    name = name.strip(" :")
    # "Born to Race" alone does not say what it is
    if re.search(r"Mystery Box", text, re.I) and not re.search(r"Mystery Box", name, re.I):
        name = f"{name} Mystery Box"
    return name, kind


@dataclass
class Moment:
    year: int
    month: int
    day: int
    time: str | None  # 'HH:MM' or None
    after_update: bool

    def local(self) -> str:
        return f"{self.year:04d}-{self.month:02d}-{self.day:02d}T{self.time}"


def moment(m: re.Match, p: str, posted: date) -> Moment:
    month = MONTHS[m.group(f"{p}_month")[:3].lower()]
    day = int(m.group(f"{p}_day"))
    year = int(m.group(f"{p}_year")) if m.group(f"{p}_year") else year_for(month, day, posted)
    clock = m.group(f"{p}_time")
    if clock:
        h, mi = clock.split(":")
        clock = f"{int(h):02d}:{mi}"
    return Moment(year, month, day, clock, bool(m.group(f"{p}_after")))


def offset_minutes(tz: str) -> int | None:
    """'UTC+8' -> 480. None for anything that is not a plain UTC offset."""
    m = re.fullmatch(r"UTC\s*([+-])\s*(\d{1,2})(?::(\d{2}))?", tz.strip(), re.I)
    if not m:
        return None
    minutes = int(m.group(2)) * 60 + int(m.group(3) or 0)
    return minutes if m.group(1) == "+" else -minutes


# ---------- parsing (no network; this is what the tests cover) ----------

def is_patch_notes(title: str) -> bool:
    return bool(PATCH_NOTES_TITLE.search(title) and VERSION.search(title))


def parse_patch_notes(html: str, url: str, external_id: str) -> Article:
    """Reads one patch-notes page into an Article with its observations."""
    soup = BeautifulSoup(html, "html.parser")
    title_tag = soup.find(class_="articleTitle")
    date_tag = soup.find(class_="articleDate")
    body = soup.find(class_="articleContent")
    title = title_tag.get_text(" ", strip=True) if title_tag else ""

    article = Article(external_id=external_id, title=title or f"NTE article {external_id}", url=url, article_kind="patch_notes")

    posted = None
    if date_tag:
        m = re.search(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", date_tag.get_text())
        if m:
            posted = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    if posted is None:  # the URL carries the post date too
        m = re.search(r"/(\d{4})(\d{2})(\d{2})/\d+\.html", url)
        if m:
            posted = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    if posted:
        # The page shows only the day; midnight UTC+8 stands in for the time.
        article.published_at = f"{posted.isoformat()}T00:00:00+08:00"

    version_match = VERSION.search(title)
    version = version_match.group(1) if version_match else ""
    lines = text_lines(str(body)) if body else []
    if body:
        article.content_hash = hashlib.md5("\n".join(lines).encode("utf-8")).hexdigest().upper()
    if not version or not lines or not posted:
        article.problems.append("No version in the title, no post date, or the article body is empty.")
        return article

    # ---- when the update ends: the version goes live then ----
    update_end_utc8 = None  # 'YYYY-MM-DDTHH:MM' on the UTC+8 clock, for UTC+8 "after update" starts
    for line in lines:
        m = MAINTENANCE.search(line)
        if not m:
            continue
        start = moment(m, "m", posted)
        offset = int(m.group("off").replace(" ", "")) * 60
        tz = timezone(timedelta(minutes=offset))
        h, mi = (int(x) for x in m.group("until").split(":"))
        ends = datetime(start.year, start.month, start.day, h, mi, tzinfo=tz)
        if start.time and (h, mi) < tuple(int(x) for x in start.time.split(":")):
            ends += timedelta(days=1)  # maintenance past midnight
        article.version_release = {"version": version, "released_at": ends.isoformat()}
        if offset == 480:
            update_end_utc8 = ends.strftime("%Y-%m-%dT%H:%M")
        break
    if article.version_release is None:
        article.problems.append("No maintenance window found; 'after update' events will start when the notes were posted.")

    # ---- the events: only inside [Update Details] ----
    try:
        first = next(i for i, l in enumerate(lines) if l.lower().startswith("[update details]"))
    except StopIteration:
        article.problems.append("No [Update Details] section found; the page layout may have changed.")
        return article
    last = next((i for i in range(first + 1, len(lines)) if lines[i].startswith("[")), len(lines))
    details = lines[first + 1:last]

    seen: dict[str, int] = {}
    section = ""
    for i, line in enumerate(details):
        if SECTION.match(line):
            section = line
        if SKIPPED_SECTION.search(section):
            continue
        is_entry = line.startswith("●") or (SECTION.match(line) and QUOTED.search(line) and re.search(r"\bEvent\b", line, re.I))
        if not is_entry:
            continue

        # Its date line: within the next few lines, before the next entry or section
        date_text = None
        for j in range(i + 1, min(i + 1 + MAX_LINES_TO_DATE, len(details))):
            if details[j].startswith("●") or SECTION.match(details[j]):
                break
            found = DATE_LINE.match(details[j])
            if found:
                date_text = found.group("value").strip()
                break
        if date_text is None:
            continue  # no dates at all (e.g. "Porsche Club Now Open")
        if not re.search(rf"\b(?:{MONTH})", date_text, re.I):
            continue  # "After the Version 1.5 update": permanent content, not an event

        name, kind = name_of(line)
        value = RANGE.match(date_text)
        if not value or not value.group("e_time") or not name:
            article.problems.append(f"Could not read the dates for {name or line[:60]!r}: {date_text[:160]}")
            continue

        tz = value.group("tz")
        if re.fullmatch(r"server\s*time", tz, re.I):
            basis, offset = "server_local", None
        else:
            offset = offset_minutes(tz)
            if offset is None:
                article.problems.append(f"Unknown clock {tz!r} for {name!r}")
                continue
            basis = "fixed_offset"

        start = moment(value, "s", posted)
        end = moment(value, "e", posted)
        if start.after_update:
            start_rule = "after_update"
            starts_local = update_end_utc8 if (basis == "fixed_offset" and offset == 480) else None
        elif start.time:
            start_rule, starts_local = "exact", start.local()
        else:
            article.problems.append(f"No start time for {name!r}: {date_text[:160]}")
            continue

        key = f"{kind}:{slug(name)}"
        occurrence = ""
        if key in seen:  # the same name twice in one version: tell them apart by end date
            occurrence = f"{end.year:04d}-{end.month:02d}-{end.day:02d}"
            key = f"{key}:{occurrence}"
        seen[key] = 1

        article.observations.append(Observation(
            observed_key=key,
            kind=kind,
            name=name,
            version=version,
            occurrence_key=occurrence,
            starts_local=starts_local,
            ends_local=end.local(),
            time_basis=basis,
            utc_offset_minutes=offset,
            start_rule=start_rule,
            official_url=url if kind == "web_event" else None,
            raw_text=f"{line} | {date_text}"[:500],
            trusted=True,
        ))

    # Complete = the whole article was read and every dated item became an observation.
    article.complete = not article.problems and bool(article.observations)
    return article


@dataclass
class IndexEntry:
    external_id: str
    url: str
    title: str
    posted: date


def parse_index(html: str) -> list[IndexEntry]:
    """The articles listed on one news index page, in page order."""
    soup = BeautifulSoup(html, "html.parser")
    entries = []
    for a in soup.find_all("a", href=True):
        m = ARTICLE_HREF.match(a["href"])
        if not m:
            continue
        title_tag = a.find(class_="title")
        title = (title_tag or a).get_text(" ", strip=True)
        day = m.group("day")
        entries.append(IndexEntry(
            external_id=m.group("id"),
            url=f"{SITE}{a['href']}",
            title=title,
            posted=date(int(day[:4]), int(day[4:6]), int(day[6:])),
        ))
    return entries


# ---------- network ----------

def index_url(page: int) -> str:
    return f"{SITE}/en/article/news/index{'' if page == 0 else page}.html"


def collect(client: httpx.Client | None = None, now: datetime | None = None) -> list[Article]:
    """Finds the patch notes posted in the last LOOKBACK_DAYS and parses them, newest first."""
    now = now or datetime.now(timezone.utc)
    oldest = (now - timedelta(days=LOOKBACK_DAYS)).date()
    own_client = client is None
    client = client or httpx.Client(timeout=30.0, headers={"User-Agent": USER_AGENT}, follow_redirects=True)
    try:
        chosen: list[IndexEntry] = []
        for page in range(MAX_INDEX_PAGES):
            response = client.get(index_url(page))
            if page > 0 and response.status_code == 404:
                break  # past the last page
            response.raise_for_status()
            entries = parse_index(response.text)
            if page == 0 and not entries:
                raise ValueError("The news index lists no articles; the site's format may have changed.")
            chosen += [e for e in entries if is_patch_notes(e.title) and oldest <= e.posted <= now.date()]
            if not entries or min(e.posted for e in entries) < oldest:
                break  # the rest of the index is older than the lookback

        articles = []
        for entry in sorted(chosen, key=lambda e: e.posted, reverse=True):
            response = client.get(entry.url)
            response.raise_for_status()
            articles.append(parse_patch_notes(response.text, entry.url, entry.external_id))
        return articles
    finally:
        if own_client:
            client.close()
