"""Request jitter and behavioral simulation for stealth scraping.

Adds random variations to make automated requests look human:
- Random scroll depth simulation
- Occasional "distraction" requests
- Variable page view durations
"""

from __future__ import annotations

import asyncio
import random
from typing import Any

from . import timing


async def simulate_page_view() -> dict[str, Any]:
    """Simulate human page viewing behavior.

    Returns:
        Dict with simulated metrics (for logging/metadata).
    """
    # Simulate reading time based on "content length"
    reading_time = timing.gaussian_delay(3000, 1500, min_ms=1000)
    await asyncio.sleep(reading_time)

    return {
        "reading_time_ms": int(reading_time * 1000),
        "scrolled": random.random() > 0.3,
        "scroll_depth": random.uniform(0.4, 1.0) if random.random() > 0.3 else 0.0,
    }


async def maybe_idle_browse(base_url: str) -> str | None:
    """Occasionally simulate browsing to a non-job page (feed, profile, etc.).

    Args:
        base_url: The base URL of the site.

    Returns:
        URL visited, or None if no browse occurred.
    """
    # 15% chance of "distraction" browsing
    if random.random() > 0.15:
        return None

    distraction_paths = [
        "/news/",
        "/feed/",
        "/company/about/",
        "/in/",
    ]

    path = random.choice(distraction_paths)
    url = base_url.rstrip("/") + path

    # Simulate viewing the distraction page
    await timing.between_requests()
    await simulate_page_view()

    return url


def random_viewport_offset() -> tuple[int, int]:
    """Generate slightly randomized viewport coordinates.

    Real users don't always have the window maximized.

    Returns:
        (x, y) tuple with small random offsets.
    """
    x = random.randint(-5, 5)
    y = random.randint(-5, 5)
    return x, y


def random_mouse_delay() -> float:
    """Generate a realistic mouse movement delay.

    Returns:
        Delay in seconds.
    """
    return timing.gaussian_delay(100, 50, min_ms=20, max_ms=300)


async def simulate_idle_session(min_seconds: int = 30, max_seconds: int = 120) -> float:
    """Simulate an idle session gap (user stepped away).

    Args:
        min_seconds: Minimum idle time.
        max_seconds: Maximum idle time.

    Returns:
        Actual idle time in seconds.
    """
    idle_time = random.uniform(min_seconds, max_seconds)
    await asyncio.sleep(idle_time)
    return idle_time


def should_take_break(request_count: int) -> bool:
    """Determine if it's time for a longer break based on request count.

    Uses probability that increases with request count.
    """
    if request_count < 10:
        return False
    if request_count > 50:
        return random.random() < 0.3
    if request_count > 30:
        return random.random() < 0.15
    return random.random() < 0.05


async def maybe_take_break(request_count: int) -> float:
    """Take a break if warranted.

    Returns:
        Break duration in seconds (0 if no break taken).
    """
    if not should_take_break(request_count):
        return 0.0

    break_duration = random.uniform(30, 120)
    await asyncio.sleep(break_duration)
    return break_duration
