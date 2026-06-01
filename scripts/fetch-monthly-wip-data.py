#!/usr/bin/env python3
"""Fetch the current month's WIP screenshot thread from the Discourse forum.

This runs at build time so the public site never performs per-visitor API calls.
The generated output is stored in `data/community/monthly-wip.json`.

The script finds the topic whose title matches "(Month YYYY) Monthly WIP Screenshot
Thread" for the current month, then extracts images and YouTube video thumbnails
from the post content.

If the current month's thread is not found, the script tries the previous month
(repeating up to MAX_MONTHLY_WIP_LOOKBACK times, default 3).  If no thread is
found within the lookback window, the script exits with an error.
"""

from __future__ import annotations

import json
import random
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DISCOURSE_BASE_URL = "https://hub.jmonkeyengine.org"
MONTHLY_CATEGORY_URL = f"{DISCOURSE_BASE_URL}/c/monthly/57.json"
USER_AGENT = "jMonkeyEngine-Website-MonthlyWipFetcher/1.0"

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

DEFAULT_OUTPUT = "data/community/monthly-wip.json"
DEFAULT_LOOKBACK_MONTHS = 3


def _read_json(url: str, payload: Optional[dict] = None, timeout: int = 30) -> Tuple[Any, dict]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    method = "GET"
    data = None

    if payload is not None:
        method = "POST"
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="ignore")
            return json.loads(raw), dict(response.headers)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP error {exc.code} fetching {url}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error fetching {url}: {exc.reason}") from exc


def _to_str(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return value.strip()


def _extract_images_from_cooked(cooked: str) -> List[str]:
    """Extract image URLs from Discourse lightbox wrappers in cooked HTML."""
    # Images live inside: <div class="lightbox-wrapper"> ... <img src="URL" ...>
    # We match the img src inside lightbox-wrapper divs.
    images: List[str] = []
    # Match all <img> tags and filter by src containing the uploads path
    for match in re.finditer(r'<img\s[^>]*src="([^"]+)"[^>]*>', cooked, re.IGNORECASE):
        src = match.group(1)
        # Skip avatars, letter proxies, and emoji
        if "/user_avatar/" in src or "/letter_avatar_proxy/" in src or "/images/" in src:
            continue
        if "uploads/default" in src or "uploads/original" in src:
            images.append(src)
    return images


def _extract_text_preview(cooked: str, max_len: int = 100) -> str:
    """Extract a short plain-text preview from cooked HTML."""
    text = re.sub(r'<div[^>]*class="[^"]*lightbox-wrapper[^"]*"[^>]*>.*?</div>', ' ', cooked, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<img[^>]*>', ' ', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) < 5:
        return ""
    if len(text) > max_len:
        text = text[:max_len].rsplit(' ', 1)[0] + "…"
    return text


def _extract_videos_from_cooked(cooked: str) -> List[Dict[str, str]]:
    """Extract YouTube video thumbnails from Discourse onebox embeds in cooked HTML."""
    videos: List[Dict[str, str]] = []
    for match in re.finditer(
        r'data-video-id="([^"]+)"',
        cooked,
        re.IGNORECASE,
    ):
        video_id = match.group(1)
        videos.append({
            "videoId": video_id,
            "videoUrl": f"https://www.youtube.com/watch?v={video_id}",
            "src": f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg",
        })
    return videos


def _fetch_topic_posts(topic_id: int) -> List[Dict[str, Any]]:
    """Fetch all posts from a topic, handling pagination."""
    url = f"{DISCOURSE_BASE_URL}/t/{topic_id}.json"
    response, _ = _read_json(url)

    post_stream = response.get("post_stream", {})
    posts = post_stream.get("posts", [])
    stream = post_stream.get("stream", [])

    # If there are more posts than returned, fetch the remaining pages
    loaded_ids = {p.get("id") for p in posts}
    remaining_ids = [pid for pid in stream if pid not in loaded_ids]

    while remaining_ids:
        batch = remaining_ids[:20]
        remaining_ids = remaining_ids[20:]
        try:
            page_response, _ = _read_json(
                f"{DISCOURSE_BASE_URL}/t/{topic_id}/posts.json",
                payload={"post_ids": batch},
            )
            page_posts = page_response.get("post_stream", {}).get("posts", [])
            posts.extend(page_posts)
        except RuntimeError:
            # If a page fails, continue with what we have
            pass

    return posts


def find_thread_for_month(year: int, month: int) -> Optional[Dict[str, Any]]:
    """Find the topic matching the WIP thread for a given year/month."""
    month_name = MONTH_NAMES[month - 1]
    expected_title = f"({month_name} {year}) Monthly WIP Screenshot Thread"

    response, _ = _read_json(MONTHLY_CATEGORY_URL)
    topics = response.get("topic_list", {}).get("topics", [])

    for topic in topics:
        title = _to_str(topic.get("title"))
        if title.lower() == expected_title.lower():
            return topic

    return None


def _decrement_month(year: int, month: int) -> Tuple[int, int]:
    """Return the previous month as (year, month)."""
    if month == 1:
        return year - 1, 12
    return year, month - 1


def main() -> None:
    import os

    parser_args = sys.argv[1:]
    output_path = DEFAULT_OUTPUT
    if "--output" in parser_args:
        idx = parser_args.index("--output")
        if idx + 1 < len(parser_args):
            output_path = parser_args[idx + 1]

    max_lookback = int(os.environ.get("MAX_MONTHLY_WIP_LOOKBACK", DEFAULT_LOOKBACK_MONTHS))

    now = datetime.now(timezone.utc)
    year, month = now.year, now.month

    print(f"[INFO] Looking for WIP thread (max {max_lookback} months lookback)...")

    topic = None
    for attempt in range(max_lookback + 1):
        month_name = MONTH_NAMES[month - 1]
        print(f"[INFO] Trying {month_name} {year}...")
        topic = find_thread_for_month(year, month)
        if topic is not None:
            break
        if attempt < max_lookback:
            print(f"[WARN] No WIP thread found for {month_name} {year}.")
            year, month = _decrement_month(year, month)

    if topic is None:
        print(
            f"[ERROR] No WIP thread found after checking {max_lookback + 1} month(s). "
            f"Tried back to {MONTH_NAMES[month - 1]} {year}."
        )
        sys.exit(1)

    topic_id = topic["id"]
    topic_slug = topic.get("slug", "")
    topic_title = _to_str(topic.get("title"))
    topic_url = f"{DISCOURSE_BASE_URL}/t/{topic_slug}/{topic_id}"

    print(f"[INFO] Found thread: {topic_title} (id={topic_id})")
    print(f"[INFO] Fetching posts...")

    posts = _fetch_topic_posts(topic_id)
    print(f"[INFO] Fetched {len(posts)} posts")

    items: List[Dict[str, Any]] = []

    for post in posts:
        cooked = _to_str(post.get("cooked", ""))
        if not cooked:
            continue

        author = _to_str(post.get("username", ""))
        preview = _extract_text_preview(cooked)
        post_number = post.get("post_number", 1)
        post_url = f"{topic_url}/{post_number}"

        images = _extract_images_from_cooked(cooked)
        if images:
            item: Dict[str, Any] = {"type": "image", "src": random.choice(images), "author": author, "postUrl": post_url}
            if preview:
                item["preview"] = preview
            items.append(item)

        for video in _extract_videos_from_cooked(cooked):
            v: Dict[str, Any] = {"type": "video", "author": author, "postUrl": post_url}
            if preview:
                v["preview"] = preview
            v.update(video)
            items.append(v)

    print(f"[INFO] Extracted {len(items)} items ({sum(1 for i in items if i['type'] == 'image')} images, {sum(1 for i in items if i['type'] == 'video')} videos)")

    generated_at = datetime.now(timezone.utc).isoformat()

    image_count = sum(1 for i in items if i["type"] == "image")
    video_count = sum(1 for i in items if i["type"] == "video")
    parts = []
    if image_count:
        parts.append(f"{image_count} screenshot{'s' if image_count != 1 else ''}")
    if video_count:
        parts.append(f"{video_count} video{'s' if video_count != 1 else ''}")
    items_summary = " and ".join(parts) if parts else "no items"

    payload = {
        "generatedAt": generated_at,
        "subtitle": f"{items_summary} — our community is very active, check what they're working on this month!",
        "topic": {
            "id": topic_id,
            "title": topic_title,
            "url": topic_url,
            "postsCount": _to_str(topic.get("posts_count")),
            "likeCount": _to_str(topic.get("like_count")),
            "views": _to_str(topic.get("views")),
        },
        "items": items,
        "status": {
            "errors": [],
            "stale": False,
        },
    }

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[OK] Wrote {out} ({len(items)} items)")


if __name__ == "__main__":
    main()
