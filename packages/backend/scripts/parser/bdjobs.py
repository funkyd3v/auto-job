"""HTML parser for Bdjobs job board scraping."""

from __future__ import annotations

import re

from typing import Any

from bs4 import BeautifulSoup, Tag

from protocol import RawJob
from parser.base import BaseParser


class BdjobsParser(BaseParser):
    """Parser for Bdjobs job board."""

    def parse_search(self, html: str, base_url: str = "https://www.bdjobs.com") -> list[RawJob]:
        """Parse search results page for jobs — robust for /h/jobs Angular SPA."""
        soup = BeautifulSoup(html, "html.parser")
        jobs: list[RawJob] = []

        # Try multiple container selectors — bdjobs SPA renders differently for /h/jobs?txtsearch=
        candidates: list[Any] = []
        for sel in ["main.mobile-job-list", "main.w-full", "main", "[class*='job-list']", "body"]:
            el = soup.select_one(sel)
            if el:
                cards = el.select("app-job-card")
                if cards:
                    candidates = cards
                    break
        # Fallback: global search if no container matched
        if not candidates:
            candidates = soup.select("app-job-card")

        for job_card in candidates:
            job = self._extract_job_from_card(job_card, base_url)
            if job:
                jobs.append(job)

        # Last fallback: if still 0, try alternate card selectors
        if not jobs and not candidates:
            for alt_sel in ["[data-testid='job-card']", ".job-card", "article"]:
                alts = soup.select(alt_sel)
                for el in alts:
                    job = self._extract_job_from_card(el, base_url)
                    if job:
                        jobs.append(job)
                if jobs:
                    break

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

    def parse_detail(self, html: str, url: str = "") -> RawJob | None:
        """Parse a job detail page (Angular SPA rendered HTML)."""
        soup = BeautifulSoup(html, "html.parser")

        job = RawJob(url=url)

        # Extract title
        title_selectors = [
            'h1[class*="title"]',
            'h1[class*="job-title"]',
            '[data-testid="job-title"]',
            "app-job-title h1",
            "h1",
        ]
        for selector in title_selectors:
            title_elem = soup.select_one(selector)
            if title_elem:
                title = self.clean_text(title_elem.get_text(strip=True))
                if title:
                    job.title = title
                    break

        # Extract company
        company_selectors = [
            '[data-testid="company"]',
            "app-job-company",
            '[class*="company"]',
            ".employer",
        ]
        for selector in company_selectors:
            company_elem = soup.select_one(selector)
            if company_elem:
                company = self.clean_text(company_elem.get_text(strip=True))
                if company:
                    job.company = company
                    break

        # Extract location
        location_selectors = [
            '[data-testid="location"]',
            '[class*="location"]',
            ".job-location",
        ]
        for selector in location_selectors:
            location_elem = soup.select_one(selector)
            if location_elem:
                location = self.clean_text(location_elem.get_text(strip=True))
                if location:
                    job.location = location
                    break

        # Extract description
        desc_selectors = [
            "app-job-description",
            '[data-testid="description"]',
            ".job-description",
            ".job-desc",
            ".job-summary",
            '[class*="job-description"]',
            '[class*="description"]',
            ".job-details",
            '[class*="job-details"]',
            '[class*="job-detail"]',
            '[class*="content"]',
        ]
        for selector in desc_selectors:
            desc_elem = soup.select_one(selector)
            if desc_elem:
                description = self.clean_html(str(desc_elem))
                if len(description.strip()) < 40:
                    continue
                job.description = description
                break

        # Fallback: SEO meta description
        if not job.description:
            for meta_sel in ["meta[property='og:description']", "meta[name='description']"]:
                meta = soup.select_one(meta_sel)
                meta_content = meta.get("content") if meta else None
                if meta_content and meta_content.strip():
                    job.description = self.clean_html(meta_content)
                    break

        if job.title:
            return job

        return None

    def extract_ref_numbers(self, html: str) -> list[str]:
        """Fast ref number extraction without full parsing."""
        patterns = [
            r"/h/details/(\d+)",
            r"details/(\d+)",
            r"id=(\d+)",
            r"ref[\s-]?(?:no|number)[:\s]*(\w+)",
        ]

        ref_numbers: list[str] = []
        for pattern in patterns:
            matches = re.findall(pattern, html)
            ref_numbers.extend(matches)

        return list(set(ref_numbers))
