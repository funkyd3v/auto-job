"""Human-like timing delays to avoid bot detection.

Uses Gaussian distribution for natural variation instead of uniform random.
Simulates reading time, scroll pauses, and session gaps.
"""

from __future__ import annotations

import asyncio
import random
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


# ─── Delay Profiles ──────────────────────────────────────────────────────────

# Gaussian parameters: (mean_ms, std_dev_ms)
DELAY_PROFILES = {
    "between_requests": (1500, 400),      # 800-2500ms typical
    "between_pages": (3500, 1200),        # 2000-8000ms typical
    "after_scroll": (800, 300),           # 500-1500ms typical
    "session_gap": (60000, 25000),        # 30-120s typical
    "tab_switch": (300, 150),             # 200-600ms typical
    "micro_pause": (150, 80),             # 50-300ms typical
}


def gaussian_delay(mean_ms: int, std_dev_ms: int, min_ms: int = 0, max_ms: int = 0) -> float:
    """Generate a Gaussian-distributed delay in seconds.

    Args:
        mean_ms: Mean delay in milliseconds.
        std_dev_ms: Standard deviation in milliseconds.
        min_ms: Minimum delay floor (milliseconds).
        max_ms: Maximum delay ceiling (0 = no cap).

    Returns:
        Delay in seconds (float).
    """
    delay_ms = random.gauss(mean_ms, std_dev_ms)
    if min_ms > 0:
        delay_ms = max(delay_ms, min_ms)
    if max_ms > 0:
        delay_ms = min(delay_ms, max_ms)
    return delay_ms / 1000.0


async def between_requests() -> float:
    """Delay between consecutive HTTP requests."""
    delay = gaussian_delay(*DELAY_PROFILES["between_requests"])
    await asyncio.sleep(delay)
    return delay


async def between_pages() -> float:
    """Delay when navigating to a new page (e.g., pagination)."""
    delay = gaussian_delay(*DELAY_PROFILES["between_pages"])
    await asyncio.sleep(delay)
    return delay


async def after_scroll() -> float:
    """Delay after scrolling action."""
    delay = gaussian_delay(*DELAY_PROFILES["after_scroll"])
    await asyncio.sleep(delay)
    return delay


async def session_gap() -> float:
    """Long delay simulating user leaving and returning."""
    delay = gaussian_delay(*DELAY_PROFILES["session_gap"], min_ms=30000)
    await asyncio.sleep(delay)
    return delay


async def tab_switch() -> float:
    """Delay when switching between tabs."""
    delay = gaussian_delay(*DELAY_PROFILES["tab_switch"])
    await asyncio.sleep(delay)
    return delay


async def micro_pause() -> float:
    """Brief pause for micro-interactions."""
    delay = gaussian_delay(*DELAY_PROFILES["micro_pause"])
    await asyncio.sleep(delay)
    return delay


def jittered_delay(base_ms: int, jitter_pct: float = 0.3) -> float:
    """Add random jitter to a base delay.

    Args:
        base_ms: Base delay in milliseconds.
        jitter_pct: Jitter as percentage of base (0.3 = ±30%).

    Returns:
        Jittered delay in seconds.
    """
    jitter_range = base_ms * jitter_pct
    delay_ms = base_ms + random.uniform(-jitter_range, jitter_range)
    return max(0, delay_ms) / 1000.0


class TimingEngine:
    """Manages timing state for a scraping session.

    Tracks request count and applies progressive slowdowns
    to mimic natural user behavior over time.
    """

    def __init__(self) -> None:
        self._request_count = 0
        self._session_start = time.monotonic()
        self._last_request_time = 0.0

    @property
    def request_count(self) -> int:
        return self._request_count

    @property
    def session_duration(self) -> float:
        return time.monotonic() - self._session_start

    async def pre_request_delay(self) -> float:
        """Apply delay before a request, considering session context.

        Returns:
            Actual delay applied (seconds).
        """
        self._request_count += 1

        # First request: no delay
        if self._request_count == 1:
            self._last_request_time = time.monotonic()
            return 0.0

        # Every 20-40 requests: longer "break"
        if self._request_count % random.randint(20, 40) == 0:
            delay = gaussian_delay(*DELAY_PROFILES["session_gap"], min_ms=15000, max_ms=45000)
            await asyncio.sleep(delay)
            self._last_request_time = time.monotonic()
            return delay

        # Every 10 requests: medium pause
        if self._request_count % 10 == 0:
            delay = gaussian_delay(*DELAY_PROFILES["between_pages"])
            await asyncio.sleep(delay)
            self._last_request_time = time.monotonic()
            return delay

        # Normal request delay
        delay = gaussian_delay(*DELAY_PROFILES["between_requests"])
        await asyncio.sleep(delay)
        self._last_request_time = time.monotonic()
        return delay

    def reset(self) -> None:
        """Reset session state."""
        self._request_count = 0
        self._session_start = time.monotonic()
        self._last_request_time = 0.0
