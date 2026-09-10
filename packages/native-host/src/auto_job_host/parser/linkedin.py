"""LinkedIn HTML parser — extracts job data from search and detail pages.

Uses BeautifulSoup with lxml for fast, reliable parsing.
Supports multiple selector strategies for resilience against UI changes.
"""

from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup, Tag

from ..protocol import RawJob
from .base import BaseParser


class LinkedInParser(BaseParser):
    """Parser for LinkedIn job pages."""

    def parse_search(self, html: str, base_url: str = "https://www.linkedin.com") -> list[RawJob]:
        """Parse LinkedIn search results page.

        Extracts job reference numbers from search results,
        then returns them for detail page fetching.
        """
        soup = BeautifulSoup(html, "lxml")
        jobs: list[RawJob] = []

        # Strategy 1: Job cards with data-tracking attributes
        cards = soup.select("[data-tracking-control-name*='job']") or []
        for card in cards:
            job = self._parse_search_card(card, base_url)
            if job and job.title:
                jobs.append(job)

        # Strategy 2: Job list items
        if not jobs:
            items = soup.select("li.jobs-search-results__list-item") or []
            for item in items:
                job = self._parse_search_card(item, base_url)
                if job and job.title:
                    jobs.append(job)

        # Strategy 3: Any card with job link
        if not jobs:
            links = soup.find_all("a", href=re.compile(r"/jobs/view/\d+"))
            for link in links:
                href = link.get("href", "")
                match = re.search(r"/jobs/view/(\d+)", href)
                if match:
                    ref_id = match.group(1)
                    title_el = link.find(["h3", "h4", "span", "div"])
                    title = title_el.get_text(strip=True) if title_el else ""
                    if title:
                        jobs.append(RawJob(
                            external_job_id=ref_id,
                            title=self.clean_text(title, 500),
                            url=f"{base_url}/jobs/view/{ref_id}/",
                            description=title,
                        ))

        return self._deduplicate(jobs)

    def _parse_search_card(self, card: Tag, base_url: str) -> RawJob | None:
        """Parse a single search result card."""
        # Extract job reference/ID
        ref_id = None
        href = ""

        # Try multiple link selectors
        link = card.find("a", href=re.compile(r"/jobs/view/"))
        if not link:
            link = card.find("a")
        if link:
            href = link.get("href", "")
            match = re.search(r"/jobs/view/(\d+)", href)
            if match:
                ref_id = match.group(1)

        # Try data attributes
        if not ref_id:
            for attr in ["data-job-id", "data-occludable-job-id", "data-entity-urn"]:
                val = card.get(attr, "")
                match = re.search(r"(\d{6,})", str(val))
                if match:
                    ref_id = match.group(1)
                    break

        # Extract title
        title = ""
        title_selectors = [
            "h3.job-card-list__title",
            "h3[class*='title']",
            ".job-card-list__title--link",
            "span.artdeco-entity-lockup__title",
            "h3",
            "a[aria-label]",
        ]
        for sel in title_selectors:
            el = card.select_one(sel)
            if el:
                title = el.get_text(strip=True)
                if title:
                    break

        if not title:
            # Try aria-label on link
            if link:
                title = link.get("aria-label", "")
            if not title:
                return None

        # Extract company
        company = ""
        company_selectors = [
            ".job-card-container__primary-description",
            ".artdeco-entity-lockup__subtitle",
            "span.job-card-container__primary-description",
            "h4",
            "[data-testid='company-name']",
        ]
        for sel in company_selectors:
            el = card.select_one(sel)
            if el:
                company = el.get_text(strip=True)
                if company:
                    break

        # Extract location
        location = ""
        loc_selectors = [
            ".job-card-container__metadata-item",
            ".artdeco-entity-lockup__caption",
            "[data-testid='text-location']",
            "span[class*='location']",
        ]
        for sel in loc_selectors:
            el = card.select_one(sel)
            if el:
                location = el.get_text(strip=True)
                if location:
                    break

        # Build URL
        if href and not href.startswith("http"):
            url = f"https://www.linkedin.com{href}"
        elif href:
            url = href
        elif ref_id:
            url = f"{base_url}/jobs/view/{ref_id}/?alternateChannel=search"
        else:
            url = base_url

        return RawJob(
            external_job_id=ref_id,
            title=self.clean_text(title, 500),
            company=self.clean_text(company, 200),
            location=self.clean_text(location, 200) if location else None,
            url=url,
            description=self.clean_text(title),
        )

    def parse_detail(self, html: str, url: str = "") -> RawJob | None:
        """Parse LinkedIn job detail page."""
        soup = BeautifulSoup(html, "lxml")

        # Extract ref ID from URL
        ref_id = None
        match = re.search(r"/jobs/view/(\d+)", url)
        if match:
            ref_id = match.group(1)

        # Title
        title = ""
        title_selectors = [
            "h1.job-details-jobs-unified-top-card__job-title",
            "h1[class*='job-title']",
            "h1.t-24",
            "p.fcd5b3a6",
            "h1",
        ]
        for sel in title_selectors:
            el = soup.select_one(sel)
            if el:
                title = el.get_text(strip=True)
                if title:
                    break

        # Company
        company = ""
        company_selectors = [
            ".job-details-jobs-unified-top-card__company-name",
            "span[class*='company-name']",
            "[aria-label^='Company, ']",
            "[aria-label^='Company logo for, ']",
            "a.job-details-jobs-unified-top-card__company-name",
        ]
        for sel in company_selectors:
            el = soup.select_one(sel)
            if el:
                company = el.get_text(strip=True)
                if not company:
                    # Try aria-label
                    company = el.get("aria-label", "")
                    company = re.sub(r"^Company( logo for)?,?\s*", "", company)
                    company = company.rstrip(".")
                if company:
                    break

        if not title or not company:
            return None

        # Location
        location = ""
        loc_selectors = [
            ".job-details-jobs-unified-top-card__bullet",
            "span._5575a1cd",
            "[class*='location']",
            ".job-details-jobs-unified-top-card__primary-description-container span",
        ]
        for sel in loc_selectors:
            el = soup.select_one(sel)
            if el:
                location = el.get_text(strip=True)
                if location:
                    break

        # Description
        description = ""
        desc_selectors = [
            ".description__text",
            ".jobs-description__content",
            "[class*='description']",
            ".show-more-less-html__markup",
            "div.jobs-box__html-content",
        ]
        for sel in desc_selectors:
            el = soup.select_one(sel)
            if el:
                description = el.get_text(strip=True)
                if description:
                    break

        # Salary
        salary = ""
        salary_selectors = [
            "[data-testid='salary-info']",
            ".salary",
            "[class*='salary']",
            ".job-details-jobs-unified-top-card__job-insight span",
        ]
        for sel in salary_selectors:
            el = soup.select_one(sel)
            if el:
                salary = el.get_text(strip=True)
                if salary:
                    break

        return RawJob(
            external_job_id=ref_id,
            title=self.clean_text(title, 500),
            company=self.clean_text(company, 200),
            location=self.clean_text(location, 200) if location else None,
            url=url or (f"https://www.linkedin.com/jobs/view/{ref_id}/" if ref_id else ""),
            description=self.clean_text(description) or self.clean_text(title),
            salary=self.clean_text(salary, 200) if salary else None,
        )

    @staticmethod
    def _deduplicate(jobs: list[RawJob]) -> list[RawJob]:
        """Remove duplicate jobs based on ID, title, and company."""
        seen: set[str] = set()
        result: list[RawJob] = []
        for job in jobs:
            key = f"{job.external_job_id}|{job.title}|{job.company}"
            if key not in seen:
                seen.add(key)
                result.append(job)
        return result

    def extract_ref_numbers(self, html: str) -> list[str]:
        """Extract job reference numbers from search results.

        This is a fast extraction without full parsing.
        """
        refs: list[str] = []

        # Pattern 1: Direct links
        for match in re.finditer(r"/jobs/view/(\d+)", html):
            refs.append(match.group(1))

        # Pattern 2: Data attributes
        for match in re.finditer(r'data-(?:job-id|entity-urn|occludable-job-id)[=:]["\']?(\d{6,})', html):
            refs.append(match.group(1))

        return list(dict.fromkeys(refs))  # Deduplicate preserving order
