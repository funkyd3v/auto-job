"""LinkedIn scraper — stealth HTTP + BeautifulSoup parsing."""

from __future__ import annotations

from typing import Any

from ..protocol import RawJob, ScrapeConfig
from ..network.client import StealthClient
from ..stealth.profiles import ProfileManager
from ..parser.linkedin import LinkedInParser
from .base import BaseScraper


class LinkedInScraper(BaseScraper):
    """Stealth LinkedIn job scraper."""

    def __init__(self, client: StealthClient, profile_manager: ProfileManager):
        super().__init__(client, profile_manager)
        self.parser = LinkedInParser()

    @property
    def source_type(self) -> str:
        return "linkedin"

    def build_search_url(self, config: dict[str, Any], page: int = 1) -> str:
        """Build LinkedIn job search URL.

        Config should contain:
            keywords: list[str] - search keywords
            location: str - optional location filter
            max_age: str - time filter (e.g., "r86400" for 24h)
        """
        keywords = config.get("keywords", [])
        if isinstance(keywords, list):
            keyword_str = " ".join(keywords)
        else:
            keyword_str = str(keywords)

        from urllib.parse import urlencode
        params = {
            "keywords": keyword_str,
            "origin": "JOB_SEARCH_PAGE_JOB_FILTER",
        }

        location = config.get("location")
        if location:
            params["location"] = location

        max_age = config.get("max_age", "r86400")
        if max_age:
            params["f_TPR"] = max_age

        return f"https://www.linkedin.com/jobs/search-results/?{urlencode(params)}"

    def parse_search_html(self, html: str, base_url: str = "https://www.linkedin.com") -> list[RawJob]:
        return self.parser.parse_search(html, base_url)

    def parse_detail_html(self, html: str, url: str = "") -> RawJob | None:
        return self.parser.parse_detail(html, url)

    def get_detail_url(self, job: RawJob) -> str | None:
        if job.external_job_id:
            return f"https://www.linkedin.com/jobs/view/{job.external_job_id}/?alternateChannel=search"
        if job.url and "/jobs/view/" in job.url:
            return job.url
        return None

    def _get_base_url(self) -> str:
        return "https://www.linkedin.com"

    def extract_ref_numbers(self, html: str) -> list[str]:
        """Fast ref number extraction without full parsing."""
        return self.parser.extract_ref_numbers(html)
