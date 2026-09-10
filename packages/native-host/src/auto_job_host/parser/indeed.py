"""Indeed HTML parser — extracts job data from search and detail pages."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, Tag

from ..protocol import RawJob
from .base import BaseParser


class IndeedParser(BaseParser):
    """Parser for Indeed job pages."""

    def parse_search(self, html: str, base_url: str = "https://www.indeed.com") -> list[RawJob]:
        """Parse Indeed search results page."""
        soup = BeautifulSoup(html, "lxml")
        jobs: list[RawJob] = []

        # Strategy 1: Job cards with data-jk attribute
        cards = soup.select("[data-jk], .job_seen_beacon, .tapItem, .slider_item")
        for card in cards:
            job = self._parse_card(card, base_url)
            if job and job.title:
                jobs.append(job)

        # Strategy 2: Job links
        if not jobs:
            links = soup.find_all("a", href=re.compile(r"/rc/clk|/viewjob"))
            for link in links:
                job = self._parse_link_card(link, base_url)
                if job and job.title:
                    jobs.append(job)

        return self._deduplicate(jobs)

    def _parse_card(self, card: Tag, base_url: str) -> RawJob | None:
        """Parse a single job card."""
        # Title
        title = ""
        title_selectors = [
            "h2.jobTitle a span",
            "h2 a",
            ".jobTitle",
            "a[data-jk]",
        ]
        for sel in title_selectors:
            el = card.select_one(sel)
            if el:
                title = el.get_text(strip=True)
                if title:
                    break

        if not title:
            return None

        # Company
        company = ""
        company_selectors = [
            "[data-testid='company-name']",
            ".companyName",
            ".company",
            "span[data-testid='company-name']",
        ]
        for sel in company_selectors:
            el = card.select_one(sel)
            if el:
                company = el.get_text(strip=True)
                if company:
                    break

        if not company:
            return None

        # Location
        location = ""
        loc_selectors = [
            "[data-testid='text-location']",
            ".companyLocation",
            "[data-testid='companyLocation']",
        ]
        for sel in loc_selectors:
            el = card.select_one(sel)
            if el:
                location = el.get_text(strip=True)
                if location:
                    break

        # External ID
        external_id = card.get("data-jk") or card.get("data-job-key")
        if external_id:
            external_id = str(external_id)

        # URL
        link = card.select_one("h2 a, a[data-jk]")
        url = ""
        if link:
            href = link.get("href", "")
            if href.startswith("/"):
                url = f"{base_url}{href}"
            elif href.startswith("http"):
                url = href

        if not url and external_id:
            url = f"{base_url}/rc/clk?jk={external_id}"

        # Snippet/description
        snippet = ""
        snippet_selectors = [
            ".job-snippet",
            "[data-testid='job-snippet']",
            ".summary",
        ]
        for sel in snippet_selectors:
            el = card.select_one(sel)
            if el:
                snippet = el.get_text(strip=True)
                if snippet:
                    break

        # Salary
        salary = ""
        salary_selectors = [
            "[data-testid='attribute_snippet_testid']",
            ".salaryText",
            "[class*='salary']",
        ]
        for sel in salary_selectors:
            el = card.select_one(sel)
            if el:
                salary = el.get_text(strip=True)
                if salary:
                    break

        return RawJob(
            external_job_id=self.clean_text(external_id, 100) if external_id else None,
            title=self.clean_text(title, 500),
            company=self.clean_text(company, 200),
            location=self.clean_text(location, 200) if location else None,
            url=url,
            description=self.clean_text(snippet) or self.clean_text(title),
            salary=self.clean_text(salary, 200) if salary else None,
        )

    def _parse_link_card(self, link: Tag, base_url: str) -> RawJob | None:
        """Parse a job from a link element."""
        title = link.get_text(strip=True)
        if not title or len(title) < 3:
            return None

        href = link.get("href", "")
        if href.startswith("/"):
            url = f"{base_url}{href}"
        elif href.startswith("http"):
            url = href
        else:
            url = base_url

        return RawJob(
            title=self.clean_text(title, 500),
            url=url,
            description=self.clean_text(title),
        )

    def parse_detail(self, html: str, url: str = "") -> RawJob | None:
        """Parse Indeed job detail page."""
        soup = BeautifulSoup(html, "lxml")

        # Title
        title = ""
        title_selectors = [
            "h1.jobsearch-JobInfoHeader-title",
            "h1[data-testid='jobsearch-JobInfoHeader-title']",
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
            "[data-testid='inlineHeader-companyName']",
            ".jobsearch-CompanyInfoContainer a",
            "a[data-testid='inlineHeader-companyName']",
        ]
        for sel in company_selectors:
            el = soup.select_one(sel)
            if el:
                company = el.get_text(strip=True)
                if company:
                    break

        if not title:
            return None

        # Location
        location = ""
        loc_selectors = [
            "[data-testid='inlineHeader-companyLocation']",
            ".jobsearch-JobInfoHeader-subtitle",
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
            "#jobDescriptionText",
            ".jobsearch-jobDescriptionText",
            "[data-testid='jobDescriptionText']",
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
            "[data-testid='attribute_snippet_testid']",
            ".jobsearch-JobInfoHeader-salary",
        ]
        for sel in salary_selectors:
            el = soup.select_one(sel)
            if el:
                salary = el.get_text(strip=True)
                if salary:
                    break

        return RawJob(
            title=self.clean_text(title, 500),
            company=self.clean_text(company, 200),
            location=self.clean_text(location, 200) if location else None,
            url=url,
            description=self.clean_text(description) or self.clean_text(title),
            salary=self.clean_text(salary, 200) if salary else None,
        )

    @staticmethod
    def _deduplicate(jobs: list[RawJob]) -> list[RawJob]:
        seen: set[str] = set()
        result: list[RawJob] = []
        for job in jobs:
            key = f"{job.url}|{job.title}|{job.company}"
            if key not in seen:
                seen.add(key)
                result.append(job)
        return result
