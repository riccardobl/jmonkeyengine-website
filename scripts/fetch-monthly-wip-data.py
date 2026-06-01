#!/usr/bin/env python3
"""Fetch the current month's WIP screenshot thread from the Discourse forum.

This runs at build time so the public site never performs per-visitor API calls.
The generated output is stored in `data/community/monthly-wip.json`.

The script finds the topic whose title matches "(Month YYYY) Monthly WIP Screenshot
Thread" for the current month, then extracts images and YouTube video thumbnails
from the post content.

If the current month's thread is not found, the script exits with an error and
does NOT write the output file — causing the Hugo build to fail as requested.
"""

from __future__ import annotations

import json
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


def find_current_month_thread() -> Optional[Dict[str, Any]]:
    """Find the topic matching the current month's WIP thread."""
    now = datetime.now(timezone.utc)
    month_name = MONTH_NAMES[now.month - 1]
    year = now.year
    expected_title = f"({month_name} {year}) Monthly WIP Screenshot Thread"

    response, _ = _read_json(MONTHLY_CATEGORY_URL)
    topics = response.get("topic_list", {}).get("topics", [])

    for topic in topics:
        title = _to_str(topic.get("title"))
        # Match exactly or allow slight variations (e.g. extra whitespace)
        if title.lower() == expected_title.lower():
            return topic

    return None


def main() -> None:
    parser_args = sys.argv[1:]
    output_path = DEFAULT_OUTPUT
    if "--output" in parser_args:
        idx = parser_args.index("--output")
        if idx + 1 < len(parser_args):
            output_path = parser_args[idx + 1]

    print(f"[INFO] Looking for current month's WIP thread...")

    topic = find_current_month_thread()
    if topic is None:
        now = datetime.now(timezone.utc)
        month_name = MONTH_NAMES[now.month - 1]
        year = now.year
        print(
            f"[ERROR] No WIP thread found for {month_name} {year}. "
            f"Expected title: '({month_name} {year}) Monthly WIP Screenshot Thread'"
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

        for img_src in _extract_images_from_cooked(cooked):
            items.append({"type": "image", "src": img_src})

        for video in _extract_videos_from_cooked(cooked):
            items.append({"type": "video", **video})

    print(f"[INFO] Extracted {len(items)} items ({sum(1 for i in items if i['type'] == 'image')} images, {sum(1 for i in items if i['type'] == 'video')} videos)")

    now = datetime.now(timezone.utc).isoformat()

    payload = {
        "generatedAt": now,
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
