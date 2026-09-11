"""HTML parser for Bdjobs job board scraping."""

from __future__ import annotations

import re

from typing import Any

from bs4 import BeautifulSoup, Tag
from ..protocol import RawJob
from .base import BaseParser


class BdjobsParser(BaseParser):
    """Parser for Bdjobs job board."""

    def parse_search(self, html: str, base_url: str = "https://www.bdjobs.com") -> list[RawJob]:
        """Parse search results page for jobs."""
        soup = BeautifulSoup(html, "html.parser")
        jobs = []

        # Find the main job list container
        main_job_list = soup.select_one("main.w-full") or soup.select_one("main")
        if not main_job_list:
            return jobs

        # Find all job cards in the list
        job_cards = main_job_list.select("app-job-card")
        for job_card in job_cards:
            job = self._extract_job_from_card(job_card, base_url)
            if job:
                jobs.append(job)

        return jobs

    def _extract_job_from_card(self, job_card: Any, base_url: str) -> RawJob | None:
        """Extract job data from a job card element."""
        job = RawJob()

        # Extract job URL from the anchor tag
        link_tag = job_card.select_one("a")
        if not link_tag or not link_tag.get("href"):
            return None

        job_url = link_tag.get("href")
        # Handle relative URLs
        if job_url.startswith("/h/details/"):
            job.url = f"https://bdjobs.com{job_url}"
        elif job_url.startswith("http"):
            job.url = job_url
        else:
            job.url = f"{base_url}{job_url}"

        # Extract external job ID from URL (e.g., /h/details/1531978?ln=1)
        match = re.search(r"/h/details/(\d+)", job_url)
        if match:
            job.external_job_id = match.group(1)

        # Extract job title from p[data-testid="job-title"]
        title_elem = job_card.select_one("p[data-testid='job-title']")
        if title_elem:
            job.title = self.clean_text(title_elem.get_text(strip=True))
        else:
            # Fallback: look for any p tag with apphighlight class
            title_elem = job_card.select_one("p.apphighlight.font-bold.block")
            if title_elem and "job-title" not in title_elem.get("class", []):
                job.title = self.clean_text(title_elem.get_text(strip=True))

        # Extract company name - find p tag with apphighlight attribute (not title)
        # The company p tag has: <p apphighlight class="font-bold text-[#333]">
        for p_tag in job_card.find_all("p"):
            attrs = p_tag.attrs
            if "apphighlight" in attrs and p_tag.get("data-testid") != "job-title":
                job.company = self.clean_text(p_tag.get_text(strip=True))
                break

        # Extract location - find p with break-words and whitespace-normal
        for p_tag in job_card.find_all("p"):
            classes = p_tag.get("class", [])
            if "break-words" in classes and "whitespace-normal" in classes:
                job.location = self.clean_text(p_tag.get_text(strip=True))
                break

        # Validate we have essential data
        if job.title and job.url:
            return job

        return None

    def _find_by_class(self, parent: Any, tag: str, class_name: str) -> Tag | None:
        """Find element by partial class name match."""
        for elem in parent.find_all(tag):
            classes = elem.get("class", [])
            if any(class_name in cls for cls in classes):
                return elem
        return None

    def parse_detail(self, html: str, url: str = "") -> RawJob | None:
        """Parse a job detail page."""
        soup = BeautifulSoup(html, "html.parser")

        job = RawJob(url=url)

        # Extract title
        title_selectors = [
            'h1[class*="title"]',
            'h1[class*="job-title"]',
            "h1",
            '[data-testid="job-title"]',
        ]

        for selector in title_selectors:
            title_elem = soup.select_one(selector)
            if title_elem:
                job.title = self.clean_text(title_elem.get_text(strip=True))
                break

        # Extract company
        company_selectors = [
            '[class*="company"]',
            '[data-testid="company"]',
            ".employer",
        ]

        for selector in company_selectors:
            company_elem = soup.select_one(selector)
            if company_elem:
                job.company = self.clean_text(company_elem.get_text(strip=True))
                break

        # Extract location
        location_selectors = [
            '[class*="location"]',
            '[data-testid="location"]',
            ".job-location",
        ]

        for selector in location_selectors:
            location_elem = soup.select_one(selector)
            if location_elem:
                job.location = self.clean_text(location_elem.get_text(strip=True))
                break

        # Extract description
        desc_selectors = [
            '[class*="description"]',
            '[data-testid="description"]',
            ".job-description",
            ".job-details",
            '[class*="content"]',
        ]

        for selector in desc_selectors:
            desc_elem = soup.select_one(selector)
            if desc_elem:
                job.description = self.clean_html(str(desc_elem))
                break

        if job.title:
            return job

        return None

    def extract_ref_numbers(self, html: str) -> list[str]:
        """Fast ref number extraction without full parsing."""
        # Extract from job URLs in the format /h/details/1531978
        patterns = [
            r"/h/details/(\d+)",
            r"details/(\d+)",
            r"id=(\d+)",
            r"ref[\s-]?(?:no|number)[:\s]*(\w+)",
        ]

        ref_numbers = []
        for pattern in patterns:
            matches = re.findall(pattern, html)
            ref_numbers.extend(matches)

        return list(set(ref_numbers))
