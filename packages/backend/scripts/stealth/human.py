"""Human behavior simulation for stealth browsing.

Simulates realistic mouse movements, scrolling, and interaction patterns
to avoid bot detection.
"""

from __future__ import annotations

import asyncio
import math
import random


async def human_mouse_move(page, target_x: int, target_y: int) -> None:
    """Move mouse to target using Bezier curve (not linear).

    Humans don't move in straight lines - they follow curved paths.
    """
    current_x = random.randint(100, 500)
    current_y = random.randint(100, 300)

    # Generate control points for Bezier curve
    control_x1 = current_x + (target_x - current_x) * random.uniform(0.2, 0.5)
    control_y1 = current_y + (target_y - current_y) * random.uniform(0.1, 0.3)
    control_x2 = current_x + (target_x - current_x) * random.uniform(0.6, 0.8)
    control_y2 = current_y + (target_y - current_y) * random.uniform(0.7, 0.9)

    # Number of steps (more distance = more steps)
    distance = math.sqrt((target_x - current_x) ** 2 + (target_y - current_y) ** 2)
    steps = max(10, int(distance / 10))

    for i in range(steps + 1):
        t = i / steps
        # Cubic Bezier formula
        x = (
            (1 - t) ** 3 * current_x
            + 3 * (1 - t) ** 2 * t * control_x1
            + 3 * (1 - t) * t**2 * control_x2
            + t**3 * target_x
        )
        y = (
            (1 - t) ** 3 * current_y
            + 3 * (1 - t) ** 2 * t * control_y1
            + 3 * (1 - t) * t**2 * control_y2
            + t**3 * target_y
        )

        await page.mouse.move(x, y)
        # Variable speed - slower at start and end (ease in/out)
        ease = 0.5 - 0.5 * math.cos(math.pi * t)
        delay = random.uniform(0.005, 0.02) * (1.5 - ease)
        await asyncio.sleep(delay)


async def human_scroll(page, distance: int | None = None) -> None:
    """Scroll with natural acceleration/deceleration.

    Humans scroll in bursts, not continuous smooth scrolling.
    """
    if distance is None:
        distance = random.randint(100, 400)

    # Scroll in bursts
    num_bursts = random.randint(2, 5)
    burst_size = distance // num_bursts

    for _ in range(num_bursts):
        # Each burst has slightly different size
        current_burst = burst_size + random.randint(-20, 20)

        # Smooth scroll within burst
        steps = random.randint(3, 6)
        for _step in range(steps):
            scroll_amount = current_burst // steps
            scroll_amount += random.randint(-5, 5)
            await page.mouse.wheel(0, scroll_amount)
            await asyncio.sleep(random.uniform(0.02, 0.08))

        # Pause between bursts (humans pause to read)
        await asyncio.sleep(random.uniform(0.1, 0.4))

    # Small scroll back (humans often overshoot slightly)
    if random.random() < 0.3:
        await page.mouse.wheel(0, -random.randint(10, 50))
        await asyncio.sleep(random.uniform(0.1, 0.3))


async def human_scroll_to_read(page, start_y: int | None = None, end_y: int | None = None) -> None:
    """Scroll naturally through content — fast with short pauses."""
    if start_y is None:
        start_y = random.randint(100, 250)
    if end_y is None:
        end_y = random.randint(400, 700)

    current_y = start_y
    while current_y < end_y:
        scroll_amount = random.randint(60, 150)
        await page.mouse.wheel(0, scroll_amount)
        current_y += scroll_amount

        # Brief reading pause
        read_time = random.uniform(0.3, 0.8)
        await asyncio.sleep(read_time)

        # Occasional back-scroll
        if random.random() < 0.25:
            backscroll = random.randint(15, 40)
            await page.mouse.wheel(0, -backscroll)
            await asyncio.sleep(random.uniform(0.2, 0.5))


async def random_mouse_jitter(page) -> None:
    """Add small random mouse movements — more frequent and varied for stealth."""
    num_movements = random.randint(4, 8)
    for _ in range(num_movements):
        x = random.randint(80, 1100)
        y = random.randint(80, 700)
        await page.mouse.move(x, y, steps=random.randint(5, 12))
        await asyncio.sleep(random.uniform(0.08, 0.35))


async def random_idle(page) -> None:
    """Random idle period — brief for fast scraping."""
    idle_time = random.uniform(0.4, 1.5)
    await asyncio.sleep(idle_time)


class HumanBehavior:
    """Encapsulates human-like browsing behavior."""

    def __init__(self, page):
        self.page = page
        self.viewport_width = 1920
        self.viewport_height = 1080

    async def on_page_load(self) -> None:
        """Behavior after page loads."""
        await random_mouse_jitter(self.page)

        if random.random() < 0.5:
            center_x = self.viewport_width // 2 + random.randint(-100, 100)
            center_y = self.viewport_height // 2 + random.randint(-100, 100)
            await human_mouse_move(self.page, center_x, center_y)

    async def on_content_loaded(self) -> None:
        """Behavior after content loads — hover more cards with longer dwell."""
        await random_idle(self.page)

        cards = await self.page.query_selector_all("app-job-card")
        if cards:
            num_hovers = min(len(cards), random.randint(1, 3))
            for _ in range(num_hovers):
                card = random.choice(cards)
                box = await card.bounding_box()
                if box:
                    target_x = box["x"] + random.randint(10, max(11, int(box["width"]) - 10))
                    target_y = box["y"] + random.randint(5, max(6, int(box["height"]) - 5))
                    await human_mouse_move(self.page, target_x, target_y)
                    await asyncio.sleep(random.uniform(0.2, 0.6))
                    if random.random() < 0.3:
                        await random_mouse_jitter(self.page)

    async def on_before_scroll(self) -> None:
        """Behavior before scrolling."""
        if random.random() < 0.3:
            await human_mouse_move(self.page, random.randint(50, 200), random.randint(200, 600))

    async def read_page(self) -> None:
        """Simulate reading — brief scroll."""
        await self.on_before_scroll()
        await human_scroll_to_read(self.page)

        if random.random() < 0.3:
            await asyncio.sleep(random.uniform(0.3, 0.8))
            await human_scroll(self.page, -random.randint(50, 150))
            await asyncio.sleep(random.uniform(0.2, 0.6))

    async def on_page_exit(self) -> None:
        """Behavior before leaving page."""
        if random.random() < 0.3:
            await human_mouse_move(self.page, random.randint(300, 700), random.randint(20, 50))
            await asyncio.sleep(random.uniform(0.2, 0.5))
