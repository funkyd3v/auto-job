"""Bdjobs scraper — stealth Playwright for JavaScript-rendered SPA."""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any

from protocol import RawJob, ScrapeConfig, ScrapeMetadata
from parser.bdjobs import BdjobsParser
from stealth.human import (
    HumanBehavior,
    random_mouse_jitter,
    human_scroll_to_read,
)

logger = logging.getLogger("autojob.scraper.bdjobs")

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

    def __init__(self) -> None:
        self.parser = BdjobsParser()

    @property
    def source_type(self) -> str:
        return "bdjobs"

    def build_search_url(self, keyword: str, location: str | None = None, page: int = 1) -> str:
        """Build Bdjobs job search URL for a single keyword."""
        from urllib.parse import urlencode, quote

        params: dict[str, Any] = {"qOT": "", "txtsearch": keyword.strip(), "lang": "en"}

        if location and str(location).strip():
            params["location"] = str(location).strip()

        return f"https://www.bdjobs.com/h/jobs?{urlencode(params, quote_via=quote)}"

    async def scrape(
        self,
        config: dict[str, Any],
        max_pages: int = 3,
        deadline_seconds: float = 180.0,
    ) -> tuple[list[RawJob], dict[str, Any]]:
        """Scrape bdjobs using stealth Playwright.

        Args:
            config: Search configuration with keywords, location, etc.
            max_pages: Maximum pages to scrape.
            deadline_seconds: Hard timeout for entire scrape (default 180s).
        """
        try:
            return await asyncio.wait_for(
                self._scrape_impl(config, max_pages),
                timeout=deadline_seconds,
            )
        except asyncio.TimeoutError:
            logger.warning("Scrape timed out after %.0fs", deadline_seconds)
            return [], {"duration": int(deadline_seconds * 1000), "pages_scraped": 0, "profile_used": "timeout"}

    async def _scrape_impl(
        self,
        config: dict[str, Any],
        max_pages: int = 3,
    ) -> tuple[list[RawJob], dict[str, Any]]:
        """Scrape bdjobs using stealth Playwright.

        Iterates each keyword independently, paginating through results for
        each one.  Jobs are deduplicated across keywords by external_job_id.
        """
        from playwright.async_api import async_playwright

        keywords = [
            k.strip()
            for k in (config.get("keywords") or [])
            if isinstance(k, str) and k.strip()
        ]
        if not keywords:
            logger.warning("No keywords provided — nothing to scrape")
            return [], {"duration": 0, "pages_scraped": 0, "profile_used": "none"}

        location = config.get("location")

        all_jobs: list[RawJob] = []
        seen_ids: set[str] = set()
        start_time = time.monotonic()
        pages_scraped = 0

        viewport = random.choice(VIEWPORTS)
        user_agent = random.choice(USER_AGENTS)
        accept_language = random.choice(ACCEPT_LANGUAGES)

        logger.info(
            "Scraping bdjobs: %d keyword(s), viewport=%s",
            len(keywords),
            viewport["width"],
        )

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

            page = await context.new_page()
            await page.add_init_script(STEALTH_JS)

            human = HumanBehavior(page)
            human.viewport_width = viewport["width"]
            human.viewport_height = viewport["height"]

            try:
                for keyword in keywords:
                    elapsed = time.monotonic() - start_time
                    if elapsed > 150:
                        logger.info(
                            "Time budget low (%.0fs elapsed) — stopping before keyword '%s'",
                            elapsed,
                            keyword,
                        )
                        break

                    url = self.build_search_url(keyword, location)
                    logger.info("Searching keyword: '%s' -> %s", keyword, url)

                    await asyncio.sleep(random.uniform(1.0, 2.0))
                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=40000)
                    except Exception as e:
                        logger.warning("Goto failed for keyword '%s': %s", keyword, e)
                        await asyncio.sleep(random.uniform(0.8, 1.2))
                        try:
                            await page.goto(url, wait_until="domcontentloaded", timeout=40000)
                        except Exception as e2:
                            logger.warning("Retry goto failed for keyword '%s': %s", keyword, e2)
                            continue

                    await asyncio.sleep(random.uniform(1.0, 2.0))
                    await random_mouse_jitter(page)

                    keyword_jobs = 0

                    for page_num in range(1, max_pages + 1):
                        try:
                            await page.wait_for_selector("app-job-card", timeout=15000)
                        except Exception as e:
                            logger.info(
                                "No more jobs on page %d for keyword '%s': %s (HTML len: %d)",
                                page_num,
                                keyword,
                                e,
                                len(await page.content()),
                            )
                            break

                        await human.on_content_loaded()
                        await asyncio.sleep(random.uniform(0.5, 1.0))
                        await human.read_page()
                        await asyncio.sleep(random.uniform(0.5, 1.5))

                        html = await page.content()
                        jobs = self.parser.parse_search(html)

                        new_jobs: list[RawJob] = []
                        for j in jobs:
                            if j.external_job_id and j.external_job_id in seen_ids:
                                continue
                            if j.url and any(j.url == x.url for x in all_jobs):
                                continue
                            new_jobs.append(j)
                            if j.external_job_id:
                                seen_ids.add(j.external_job_id)

                        if page_num > 1 and not new_jobs:
                            logger.info(
                                "Page %d: no new jobs for keyword '%s', stopping",
                                page_num,
                                keyword,
                            )
                            break

                        all_jobs.extend(new_jobs if page_num > 1 else jobs)
                        for j in (new_jobs if page_num > 1 else jobs):
                            if j.external_job_id:
                                seen_ids.add(j.external_job_id)
                        keyword_jobs += len(new_jobs if page_num > 1 else jobs)
                        pages_scraped += 1
                        logger.info(
                            "Page %d (keyword '%s'): found %d jobs (total: %d)",
                            page_num,
                            keyword,
                            len(new_jobs if page_num > 1 else jobs),
                            len(all_jobs),
                        )

                        if len(jobs) == 0:
                            break

                        if page_num < max_pages:
                            await asyncio.sleep(random.uniform(2.0, 4.0))
                            await random_mouse_jitter(page)
                            await human_scroll_to_read(page)
                            await asyncio.sleep(random.uniform(1.0, 2.0))

                    logger.info(
                        "Keyword '%s' complete: %d new jobs found",
                        keyword,
                        keyword_jobs,
                    )

            finally:
                await browser.close()

        duration_ms = int((time.monotonic() - start_time) * 1000)
        metadata = {
            "duration": duration_ms,
            "pages_scraped": pages_scraped,
            "profile_used": f"playwright-{viewport['width']}x{viewport['height']}",
        }

        return all_jobs, metadata

    async def scrape_detail(self, job: RawJob) -> RawJob | None:
        """Scrape a Bdjobs detail page for the full description."""
        from playwright.async_api import async_playwright

        detail_url = self.get_detail_url(job)
        if not detail_url:
            return job

        viewport = random.choice(VIEWPORTS)
        user_agent = random.choice(USER_AGENTS)
        accept_language = random.choice(ACCEPT_LANGUAGES)

        logger.info("Scraping bdjobs detail: %s", detail_url)

        try:
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
                    extra_http_headers={"Accept-Language": accept_language},
                )

                page = await context.new_page()
                await page.add_init_script(STEALTH_JS)

                human = HumanBehavior(page)
                human.viewport_width = viewport["width"]
                human.viewport_height = viewport["height"]

                # Human-like navigation to the detail view
                await asyncio.sleep(random.uniform(1.0, 2.0))
                await page.goto(detail_url, wait_until="domcontentloaded", timeout=45000)
                await random_mouse_jitter(page)
                await asyncio.sleep(random.uniform(0.5, 1.5))

                # Wait for the Angular detail view to render
                try:
                    await page.wait_for_selector(
                        "h1, [data-testid='job-title'], [class*='job-title'], app-job-details",
                        timeout=15000,
                    )
                except Exception:
                    logger.info("Detail render selectors not found for: %s", detail_url)

                await human.on_content_loaded()
                await asyncio.sleep(random.uniform(0.5, 1.0))
                html = await page.content()

                await browser.close()
        except Exception as e:
            logger.warning("Detail scrape failed for %s: %s", detail_url, e)
            return job

        detail = self.parser.parse_detail(html, detail_url)
        if not detail:
            return job

        return self._merge_search_and_detail(job, detail)

    @staticmethod
    def _merge_search_and_detail(search_job: RawJob, detail_job: RawJob) -> RawJob:
        """Merge search card data with detail page data — detail wins on description."""
        return RawJob(
            external_job_id=detail_job.external_job_id or search_job.external_job_id,
            title=detail_job.title or search_job.title,
            company=detail_job.company or search_job.company,
            location=detail_job.location or search_job.location,
            url=detail_job.url or search_job.url,
            description=detail_job.description or search_job.description,
            salary=detail_job.salary or search_job.salary,
            scraped_at=search_job.scraped_at or detail_job.scraped_at,
        )

    def get_detail_url(self, job: RawJob) -> str | None:
        if job.external_job_id:
            return f"https://www.bdjobs.com/h/details/{job.external_job_id}"
        if job.url and "/h/details/" in job.url:
            return job.url
        return None

    def parse_search_html(self, html: str, base_url: str = "https://www.bdjobs.com") -> list[RawJob]:
        return self.parser.parse_search(html, base_url)

    def parse_detail_html(self, html: str, url: str = "") -> RawJob | None:
        return self.parser.parse_detail(html, url)
