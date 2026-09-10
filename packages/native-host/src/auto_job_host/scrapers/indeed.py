"""Indeed scraper — stealth HTTP + BeautifulSoup parsing."""

from __future__ import annotations

from typing import Any

from ..protocol import RawJob, ScrapeConfig
from ..network.client import StealthClient
from ..stealth.profiles import ProfileManager
from ..parser.indeed import IndeedParser
from .base import BaseScraper


class IndeedScraper(BaseScraper):
    """Stealth Indeed job scraper."""

    def __init__(self, client: StealthClient, profile_manager: ProfileManager):
        super().__init__(client, profile_manager)
        self.parser = IndeedParser()

    @property
    def source_type(self) -> str:
        return "indeed"

    def build_search_url(self, config: dict[str, Any], page: int = 1) -> str:
        """Build Indeed job search URL.

        Config should contain:
            search_url: str - full search URL from Indeed
            or keywords + location
        """
        if "search_url" in config:
            base_url = config["search_url"]
        else:
            from urllib.parse import urlencode
            keywords = config.get("keywords", [])
            location = config.get("location", "")

            if isinstance(keywords, list):
                keyword_str = " ".join(keywords)
            else:
                keyword_str = str(keywords)

            params = {"q": keyword_str}
            if location:
                params["l"] = location

            base_url = f"https://www.indeed.com/jobs?{urlencode(params)}"

        # Handle pagination
        if page > 1:
            separator = "&" if "?" in base_url else "?"
            base_url = f"{base_url}{separator}start={10 * (page - 1)}"

        return base_url

    def parse_search_html(self, html: str, base_url: str = "https://www.indeed.com") -> list[RawJob]:
        return self.parser.parse_search(html, base_url)

    def parse_detail_html(self, html: str, url: str = "") -> RawJob | None:
        return self.parser.parse_detail(html, url)

    def get_detail_url(self, job: RawJob) -> str | None:
        if job.url and ("viewjob" in job.url or "/rc/clk" in job.url):
            return job.url
        return None

    def _get_base_url(self) -> str:
        return "https://www.indeed.com"
