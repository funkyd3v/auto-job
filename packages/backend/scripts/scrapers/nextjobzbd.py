"""NextJobzBD scraper — stealth Playwright for JavaScript-rendered Next.js SPA."""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any

from protocol import RawJob, ScrapeConfig, ScrapeMetadata
from parser.nextjobzbd import NextJobzBdParser
from stealth.human import (
    HumanBehavior,
    random_mouse_jitter,
    human_scroll_to_read,
)

logger = logging.getLogger("autojob.scraper.nextjobzbd")

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

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]

ACCEPT_LANGUAGES = [
    "en-US,en;q=0.9",
    "en-US,en;q=0.9,bn;q=0.8",
    "en-US,en;q=0.9,hi;q=0.8",
]

STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
window.chrome = { runtime: {} };
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' ?
    Promise.resolve({ state: Notification.permission }) :
    originalQuery(parameters)
);
Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
});
Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
});
"""


class NextJobzBdScraper:
    """Stealth NextJobzBD scraper using Playwright for Next.js SPA."""

    def __init__(self) -> None:
        self.parser = NextJobzBdParser()

    @property
    def source_type(self) -> str:
        return "nextjobzbd"

    def build_search_url(self, keyword: str, page: int = 1) -> str:
        """Build NextJobzBD job search URL for a single keyword.

        URL format: https://nextjobz.com.bd/jobs?q=<keyword>&page=<n>&size=10
        Keyword spaces are replaced with + (not %20).
        """
        keyword_str = keyword.strip().replace(" ", "+")
        return f"https://nextjobz.com.bd/jobs?q={keyword_str}&page={page}&size=10"

    async def scrape(
        self,
        config: dict[str, Any],
        max_pages: int = 3,
        deadline_seconds: float = 220.0,
    ) -> tuple[list[RawJob], dict[str, Any]]:
        """Scrape NextJobzBD using stealth Playwright.

        Args:
            config: Search configuration with keywords, etc.
            max_pages: Maximum pages to scrape.
            deadline_seconds: Hard timeout for entire scrape (default 220s).
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
        """Scrape NextJobzBD using stealth Playwright.

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

        all_jobs: list[RawJob] = []
        seen_ids: set[str] = set()
        start_time = time.monotonic()
        pages_scraped = 0

        viewport = random.choice(VIEWPORTS)
        user_agent = random.choice(USER_AGENTS)
        accept_language = random.choice(ACCEPT_LANGUAGES)

        logger.info(
            "Scraping nextjobzbd: %d keyword(s), viewport=%s",
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
                    if elapsed > 190:
                        logger.info(
                            "Time budget low (%.0fs elapsed) — stopping before keyword '%s'",
                            elapsed,
                            keyword,
                        )
                        break

                    base_url = self.build_search_url(keyword)
                    logger.info("Searching keyword: '%s' -> %s", keyword, base_url)

                    keyword_jobs = 0

                    for page_num in range(1, max_pages + 1):
                        if page_num == 1:
                            url = base_url
                        else:
                            url = f"{base_url}&page={page_num}"

                        await asyncio.sleep(random.uniform(0.3, 0.7))
                        try:
                            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                        except Exception as e:
                            logger.warning(
                                "Goto failed page %d for keyword '%s': %s",
                                page_num,
                                keyword,
                                e,
                            )
                            if page_num == 1:
                                await asyncio.sleep(random.uniform(0.8, 1.2))
                                try:
                                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                                except Exception as e2:
                                    logger.warning(
                                        "Retry goto failed page %d for keyword '%s': %s",
                                        page_num,
                                        keyword,
                                        e2,
                                    )
                                    break
                            else:
                                break
                        await asyncio.sleep(random.uniform(0.6, 1.0))

                        try:
                            await page.wait_for_selector(
                                'a[href*="/jobs/"][href*="IJOB"], p.card-title',
                                timeout=10000,
                            )
                        except Exception as e:
                            logger.info(
                                "No job cards found on page %d for keyword '%s': %s (HTML len: %d)",
                                page_num,
                                keyword,
                                e,
                                len(await page.content()),
                            )
                            await asyncio.sleep(random.uniform(0.4, 0.8))
                            html_probe = await page.content()
                            if not self.parser.parse_search(html_probe):
                                break

                        try:
                            html_check = await page.content()
                            if "No jobs found" in html_check or "no jobs found" in html_check.lower():
                                if not self.parser.parse_search(html_check):
                                    logger.info(
                                        "No jobs found on page %d for keyword '%s' — stopping pagination",
                                        page_num,
                                        keyword,
                                    )
                                    break
                        except Exception:
                            pass

                        await asyncio.sleep(random.uniform(0.3, 0.6))
                        await random_mouse_jitter(page)
                        await human_scroll_to_read(page)
                        await asyncio.sleep(random.uniform(0.2, 0.4))

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

                        if not jobs:
                            break

                        if page_num < max_pages:
                            await asyncio.sleep(random.uniform(0.8, 1.5))

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
        """Scrape a NextJobzBD detail page for the full description."""
        from playwright.async_api import async_playwright

        detail_url = self.get_detail_url(job)
        if not detail_url:
            return job

        viewport = random.choice(VIEWPORTS)
        user_agent = random.choice(USER_AGENTS)
        accept_language = random.choice(ACCEPT_LANGUAGES)

        logger.info("Scraping nextjobzbd detail: %s", detail_url)

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

                await asyncio.sleep(random.uniform(1.0, 2.0))
                await page.goto(detail_url, wait_until="domcontentloaded", timeout=45000)
                await random_mouse_jitter(page)
                await asyncio.sleep(random.uniform(0.5, 1.5))

                try:
                    await page.wait_for_selector(
                        "h1.MuiTypography-h1, [class*='Typography-h1'], .quillPreview",
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
        if job.url:
            return job.url
        if job.external_job_id:
            return f"https://nextjobz.com.bd/jobs/{job.external_job_id}"
        return None

    def parse_search_html(self, html: str, base_url: str = "https://nextjobz.com.bd") -> list[RawJob]:
        return self.parser.parse_search(html, base_url)

    def parse_detail_html(self, html: str, url: str = "") -> RawJob | None:
        return self.parser.parse_detail(html, url)
