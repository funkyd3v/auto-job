"""Realistic HTTP header construction and ordering.

Different browsers send headers in different orders. This module
constructs headers that match real browser behavior exactly.
"""

from __future__ import annotations

import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .profiles import BrowserProfile


def build_headers(
    profile: BrowserProfile,
    referer: str | None = None,
    extra: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build a complete set of headers matching the browser profile.

    Args:
        profile: Browser fingerprint profile.
        referer: Optional Referer header.
        extra: Additional headers to include.

    Returns:
        Ordered dict of headers.
    """
    headers = profile.get_ordered_headers()

    # Add referer if provided
    if referer:
        headers["Referer"] = referer

    # Merge extra headers
    if extra:
        headers.update(extra)

    return headers


def build_linkedin_headers(
    profile: BrowserProfile,
    referer: str | None = None,
) -> dict[str, str]:
    """Build headers specifically for LinkedIn requests.

    LinkedIn checks for specific headers and their ordering.
    """
    headers = build_headers(profile, referer)

    # LinkedIn-specific headers that must be present
    if "LinkedIn" not in headers.get("User-Agent", ""):
        # Ensure User-Agent is set from profile
        headers["User-Agent"] = profile.headers.get(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )

    # LinkedIn often checks for these
    if "X-Requested-With" not in headers:
        headers["X-Requested-With"] = "XMLHttpRequest"

    return headers


def build_indeed_headers(
    profile: BrowserProfile,
    referer: str | None = None,
) -> dict[str, str]:
    """Build headers specifically for Indeed requests."""
    headers = build_headers(profile, referer)

    # Indeed-specific
    if "Referer" not in headers and referer:
        headers["Referer"] = referer

    return headers


def strip_extension_headers(headers: dict[str, str]) -> dict[str, str]:
    """Remove any headers that might identify the request as automated.

    Strips custom headers that could be fingerprinted.
    """
    # Headers that reveal automation
    dangerous_headers = {
        "X-Extension-Id",
        "X-Automation",
        "X-Request-Source",
        "X-Client-Id",
    }

    return {k: v for k, v in headers.items() if k not in dangerous_headers}


def randomize_header_values(
    headers: dict[str, str],
    profile: BrowserProfile,
) -> dict[str, str]:
    """Slightly randomize certain header values to increase entropy.

    Real browsers have subtle differences even within the same version.
    """
    result = dict(headers)

    # Slight Accept variations
    if "Accept" in result:
        accept_parts = result["Accept"].split(",")
        if len(accept_parts) > 3:
            # Occasionally reorder the last few items
            if random.random() > 0.7:
                tail = accept_parts[-2:]
                random.shuffle(tail)
                accept_parts[-2:] = tail
                result["Accept"] = ",".join(accept_parts)

    # Viewport width variations
    if "Viewport-Width" in result:
        base_width = profile.viewport_width
        offset = random.choice([-2, -1, 0, 0, 0, 1, 2])
        result["Viewport-Width"] = str(base_width + offset)

    return result
