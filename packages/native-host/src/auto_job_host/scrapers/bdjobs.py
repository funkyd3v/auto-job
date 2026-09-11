"""Bdjobs scraper — stealth Playwright for JavaScript-rendered SPA."""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any

from ..protocol import RawJob, ScrapeMetadata
from ..parser.bdjobs import BdjobsParser
from ..stealth.human import (
    HumanBehavior,
    human_mouse_move,
    human_scroll,
    human_scroll_to_read,
    random_mouse_jitter,
    random_idle,
)

logger = logging.getLogger("autojob-host.bdjobs")

# Realistic viewport sizes (width, height)
VIEWPORTS = [
    {"width": 1920, "height": 1080},
    {"width": 1366, "height": 768},
    {"width": 1536, "height": 864},
    {"width": 1440, "height": 900},
    {"width": 1280, "height": 720},
    {"width": 2560, "height": 1440},
    {"width": 1280, "height": 800},
    {"width": 1600, "height": 900},
]

# Realistic user agents
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]

# Accept-Language header
ACCEPT_LANGUAGES = [
    "en-US,en;q=0.9",
    "en-US,en;q=0.9,bn;q=0.8",
    "en-US,en;q=0.9,hi;q=0.8",
]

# Stealth JS injection to hide automation
STEALTH_JS = """
// Override webdriver detection
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

// Override chrome runtime
window.chrome = { runtime: {} };

// Override permissions
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
    Promise.resolve({ state: Notification.permission }) :
    originalQuery(parameters)
);

// Override plugins
Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
});

// Override languages
Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
});
"""


class BdjobsScraper:
    """Stealth Bdjobs scraper using Playwright."""

    def __init__(self, client=None, profile_manager=None):
        self.parser = BdjobsParser()
        self._client = client
        self._profile_manager = profile_manager
        self._cookie_file = "/tmp/bdjobs_cookies.json"

    @property
    def source_type(self) -> str:
        return "bdjobs"

    def build_search_url(self, config: dict[str, Any], page: int = 1) -> str:
        """Build Bdjobs job search URL."""
        keywords = config.get("keywords", [])
        if isinstance(keywords, list):
            keyword_str = " ".join(keywords)
        else:
            keyword_str = str(keywords)

        from urllib.parse import urlencode
        params = {"keywords": keyword_str, "page": page}

        location = config.get("location")
        if location:
            params["location"] = location

        return f"https://www.bdjobs.com/h/jobs?{urlencode(params)}"

    async def scrape(
        self,
        config: dict[str, Any],
        session_id: str = "default",
        max_pages: int = 3,
    ) -> tuple[list[RawJob], dict[str, Any]]:
        """Scrape bdjobs using stealth Playwright."""
        from playwright.async_api import async_playwright

        all_jobs: list[RawJob] = []
        start_time = time.monotonic()
        pages_scraped = 0

        viewport = random.choice(VIEWPORTS)
        user_agent = random.choice(USER_AGENTS)
        accept_language = random.choice(ACCEPT_LANGUAGES)

        logger.info("Scraping bdjobs: viewport=%s", viewport["width"])

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                    "--no-sandbox",
                ],
            )

            context = await browser.new_context(
                viewport=viewport,
                user_agent=user_agent,
                locale="en-US",
                timezone_id="Asia/Dhaka",
                extra_http_headers={
                    "Accept-Language": accept_language,
                },
            )

            # Load cookies if available
            await self._load_cookies(context)

            page = await context.new_page()

            # Inject stealth scripts
            await page.add_init_script(STEALTH_JS)

            # Initialize human behavior
            human = HumanBehavior(page)
            human.viewport_width = viewport["width"]
            human.viewport_height = viewport["height"]

            try:
                for page_num in range(1, max_pages + 1):
                    url = self.build_search_url(config, page=page_num)

                    # Human-like delay between pages
                    if page_num > 1:
                        delay = random.uniform(2.0, 5.0)
                        await asyncio.sleep(delay)

                    await page.goto(url, wait_until="networkidle", timeout=30000)

                    # Wait for job cards to appear
                    try:
                        await page.wait_for_selector("app-job-card", timeout=20000)
                    except Exception as e:
                        logger.info("No more jobs on page %d: %s", page_num, e)
                        break

                    # Human behavior after content loads
                    await human.on_content_loaded()

                    # Simulate reading the page
                    await human.read_page()

                    # Get rendered HTML
                    html = await page.content()
                    jobs = self.parser.parse_search(html)
                    all_jobs.extend(jobs)
                    pages_scraped += 1

                    logger.info("Page %d: found %d jobs (total: %d)", page_num, len(jobs), len(all_jobs))

                    if len(jobs) == 0:
                        break

            finally:
                # Save cookies for next session
                await self._save_cookies(context)
                await browser.close()

        duration_ms = int((time.monotonic() - start_time) * 1000)
        metadata = {
            "duration": duration_ms,
            "pages_scraped": pages_scraped,
            "profile_used": f"playwright-{viewport['width']}x{viewport['height']}",
        }

        return all_jobs, metadata

    async def scrape_search(
        self,
        config: Any,
        search_url: str,
        session_id: str,
        max_pages: int = 3,
    ) -> tuple[list[RawJob], ScrapeMetadata]:
        """Interface method called by main.py.

        Args:
            config: ScrapeConfig or dict with keywords, location, etc.
            search_url: The search URL to scrape.
            session_id: Session ID for tracking.
            max_pages: Maximum pages to scrape.

        Returns:
            Tuple of (list of jobs, metadata).
        """
        # Extract keywords from config or URL
        from urllib.parse import urlparse, parse_qs

        # Get keywords from config (could be ScrapeConfig or dict)
        keywords = []
        location = None

        if hasattr(config, "keywords"):
            keywords = config.keywords or []
        elif isinstance(config, dict):
            keywords = config.get("keywords", [])

        if hasattr(config, "location"):
            location = config.location
        elif isinstance(config, dict):
            location = config.get("location")

        # If no keywords in config, try to extract from URL
        if not keywords and search_url:
            parsed = urlparse(search_url)
            params = parse_qs(parsed.query)
            keywords_str = params.get("keywords", [""])[0]
            if keywords_str:
                keywords = keywords_str.split()
            if not location:
                location = params.get("location", [None])[0]

        scrape_config = {
            "keywords": keywords,
            "location": location,
        }

        jobs, metadata_dict = await self.scrape(
            config=scrape_config,
            session_id=session_id,
            max_pages=max_pages,
        )

        # Convert dict metadata to ScrapeMetadata
        metadata = ScrapeMetadata(
            duration=metadata_dict.get("duration", 0),
            profile_used=metadata_dict.get("profile_used", "playwright"),
            pages_scraped=metadata_dict.get("pages_scraped", 0),
        )

        return jobs, metadata

    async def _load_cookies(self, context) -> None:
        """Load cookies from file."""
        import json
        from pathlib import Path

        cookie_path = Path(self._cookie_file)
        if cookie_path.exists():
            try:
                cookies = json.loads(cookie_path.read_text())
                await context.add_cookies(cookies)
                logger.debug("Loaded %d cookies", len(cookies))
            except Exception as e:
                logger.warning("Failed to load cookies: %s", e)

    async def _save_cookies(self, context) -> None:
        """Save cookies to file."""
        import json
        from pathlib import Path

        try:
            cookies = await context.cookies()
            Path(self._cookie_file).write_text(json.dumps(cookies))
            logger.debug("Saved %d cookies", len(cookies))
        except Exception as e:
            logger.warning("Failed to save cookies: %s", e)

    def parse_search_html(self, html: str, base_url: str = "https://www.bdjobs.com") -> list[RawJob]:
        return self.parser.parse_search(html, base_url)

    def parse_detail_html(self, html: str, url: str = "") -> RawJob | None:
        return self.parser.parse_detail(html, url)

    def get_detail_url(self, job: RawJob) -> str | None:
        if job.external_job_id:
            return f"https://www.bdjobs.com/h/details/{job.external_job_id}"
        if job.url and "/h/details/" in job.url:
            return job.url
        return None

    def _get_base_url(self) -> str:
        return "https://www.bdjobs.com"

    def extract_ref_numbers(self, html: str) -> list[str]:
        """Fast ref number extraction without full parsing."""
        return self.parser.extract_ref_numbers(html)
