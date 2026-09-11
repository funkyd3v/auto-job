"""Human behavior simulation for stealth browsing.

Simulates realistic mouse movements, scrolling, and interaction patterns
to avoid bot detection.
"""

from __future__ import annotations

import asyncio
import math
import random
from typing import Any


async def human_mouse_move(page, target_x: int, target_y: int) -> None:
    """Move mouse to target using Bezier curve (not linear).

    Humans don't move in straight lines - they follow curved paths.
    """
    # Get current mouse position (approximate)
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
        x = (1 - t) ** 3 * current_x + 3 * (1 - t) ** 2 * t * control_x1 + \
            3 * (1 - t) * t ** 2 * control_x2 + t ** 3 * target_x
        y = (1 - t) ** 3 * current_y + 3 * (1 - t) ** 2 * t * control_y1 + \
            3 * (1 - t) * t ** 2 * control_y2 + t ** 3 * target_y

        await page.mouse.move(x, y)
        # Variable speed - slower at start and end (ease in/out)
        ease = 0.5 - 0.5 * math.cos(math.pi * t)
        delay = random.uniform(0.005, 0.02) * (1.5 - ease)
        await asyncio.sleep(delay)


async def human_scroll(page, distance: int = None) -> None:
    """Scroll with natural acceleration/deceleration.

    Humans scroll in bursts, not continuous smooth scrolling.
    """
    if distance is None:
        distance = random.randint(100, 400)

    # Scroll in bursts
    num_bursts = random.randint(2, 5)
    burst_size = distance // num_bursts

    for i in range(num_bursts):
        # Each burst has slightly different size
        current_burst = burst_size + random.randint(-20, 20)

        # Smooth scroll within burst
        steps = random.randint(3, 6)
        for step in range(steps):
            scroll_amount = current_burst // steps
            # Add some randomness
            scroll_amount += random.randint(-5, 5)
            await page.mouse.wheel(0, scroll_amount)
            await asyncio.sleep(random.uniform(0.02, 0.08))

        # Pause between bursts (humans pause to read)
        await asyncio.sleep(random.uniform(0.1, 0.4))

    # Small scroll back (humans often overshoot slightly)
    if random.random() < 0.3:
        await page.mouse.wheel(0, -random.randint(10, 50))
        await asyncio.sleep(random.uniform(0.1, 0.3))


async def human_scroll_to_read(page, start_y: int = None, end_y: int = None) -> None:
    """Scroll naturally through content as if reading.

    Simulates reading behavior - scroll down, pause, scroll more.
    """
    if start_y is None:
        start_y = random.randint(200, 400)
    if end_y is None:
        end_y = random.randint(800, 1200)

    current_y = start_y
    while current_y < end_y:
        # Scroll a bit
        scroll_amount = random.randint(50, 150)
        await page.mouse.wheel(0, scroll_amount)
        current_y += scroll_amount

        # Pause to "read" (longer pause = more interesting content)
        read_time = random.uniform(0.5, 2.0)
        await asyncio.sleep(read_time)

        # Sometimes scroll back a little (re-reading)
        if random.random() < 0.2:
            backscroll = random.randint(20, 60)
            await page.mouse.wheel(0, -backscroll)
            await asyncio.sleep(random.uniform(0.3, 0.8))


async def human_hover(page, selector: str) -> bool:
    """Hover over an element naturally."""
    try:
        element = await page.query_selector(selector)
        if element:
            box = await element.bounding_box()
            if box:
                # Hover to a random point within the element
                target_x = box["x"] + random.randint(5, max(6, int(box["width"]) - 5))
                target_y = box["y"] + random.randint(2, max(3, int(box["height"]) - 2))
                await human_mouse_move(page, target_x, target_y)
                await asyncio.sleep(random.uniform(0.1, 0.3))
                return True
    except Exception:
        pass
    return False


async def human_click(page, selector: str) -> bool:
    """Click an element with natural delay."""
    try:
        element = await page.query_selector(selector)
        if element:
            box = await element.bounding_box()
            if box:
                # Move to element first
                target_x = box["x"] + random.randint(5, max(6, int(box["width"]) - 5))
                target_y = box["y"] + random.randint(2, max(3, int(box["height"]) - 2))
                await human_mouse_move(page, target_x, target_y)

                # Small delay before click (human reaction time)
                await asyncio.sleep(random.uniform(0.05, 0.2))

                # Click
                await page.mouse.click(target_x, target_y)

                # Delay after click
                await asyncio.sleep(random.uniform(0.1, 0.3))
                return True
    except Exception:
        pass
    return False


async def human_type(page, selector: str, text: str) -> bool:
    """Type text with realistic speed and occasional typos."""
    try:
        element = await page.query_selector(selector)
        if element:
            await element.click()
            await asyncio.sleep(random.uniform(0.1, 0.3))

            for char in text:
                # Variable typing speed (faster for common letters)
                delay = random.uniform(0.05, 0.15)
                if char in " ":
                    delay = random.uniform(0.1, 0.3)  # Pause at spaces
                await asyncio.sleep(delay)
                await page.keyboard.type(char)

                # Occasional typo and correction (5% chance)
                if random.random() < 0.05:
                    wrong_char = chr(ord(char) + random.randint(-2, 2))
                    await page.keyboard.type(wrong_char)
                    await asyncio.sleep(random.uniform(0.1, 0.3))
                    await page.keyboard.press("Backspace")
                    await asyncio.sleep(random.uniform(0.05, 0.15))

            return True
    except Exception:
        pass
    return False


async def random_mouse_jitter(page) -> None:
    """Add small random mouse movements (simulates hand tremor)."""
    num_movements = random.randint(2, 5)
    for _ in range(num_movements):
        x = random.randint(100, 800)
        y = random.randint(100, 500)
        await page.mouse.move(x, y, steps=random.randint(3, 8))
        await asyncio.sleep(random.uniform(0.05, 0.2))


async def random_idle(page) -> None:
    """Random idle period (human distraction/reading)."""
    idle_time = random.uniform(0.5, 3.0)
    await asyncio.sleep(idle_time)


class HumanBehavior:
    """Encapsulates human-like browsing behavior."""

    def __init__(self, page):
        self.page = page
        self.viewport_width = 1920
        self.viewport_height = 1080

    async def on_page_load(self) -> None:
        """Behavior after page loads."""
        # Random jitter
        await random_mouse_jitter(self.page)

        # Sometimes move mouse to center of page
        if random.random() < 0.5:
            center_x = self.viewport_width // 2 + random.randint(-100, 100)
            center_y = self.viewport_height // 2 + random.randint(-100, 100)
            await human_mouse_move(self.page, center_x, center_y)

    async def on_content_loaded(self) -> None:
        """Behavior after content loads (job cards visible)."""
        # Look at the content
        await random_idle(self.page)

        # Move mouse over some job cards
        cards = await self.page.query_selector_all("app-job-card")
        if cards:
            # Hover over 1-3 random cards
            num_hovers = min(len(cards), random.randint(1, 3))
            for _ in range(num_hovers):
                card = random.choice(cards)
                box = await card.bounding_box()
                if box:
                    target_x = box["x"] + random.randint(10, max(11, int(box["width"]) - 10))
                    target_y = box["y"] + random.randint(5, max(6, int(box["height"]) - 5))
                    await human_mouse_move(self.page, target_x, target_y)
                    await asyncio.sleep(random.uniform(0.3, 0.8))

    async def on_before_scroll(self) -> None:
        """Behavior before scrolling."""
        # Move mouse to side (as if preparing to scroll)
        if random.random() < 0.3:
            await human_mouse_move(self.page, random.randint(50, 200), random.randint(200, 600))

    async def read_page(self) -> None:
        """Simulate reading the page content."""
        # Scroll through content
        await self.on_before_scroll()
        await human_scroll_to_read(self.page)

        # Sometimes scroll back up
        if random.random() < 0.4:
            await asyncio.sleep(random.uniform(0.5, 1.5))
            await human_scroll(self.page, -random.randint(100, 300))

    async def on_page_exit(self) -> None:
        """Behavior before leaving page."""
        # Move mouse to top (as if going to address bar)
        if random.random() < 0.3:
            await human_mouse_move(self.page, random.randint(300, 700), random.randint(20, 50))
            await asyncio.sleep(random.uniform(0.2, 0.5))
