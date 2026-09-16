"""HTML parser for NextJobzBD job board scraping."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, Tag

from protocol import RawJob
from parser.base import BaseParser


class NextJobzBdParser(BaseParser):
    """Parser for NextJobzBD job board (Next.js + MUI SPA)."""

    def parse_search(self, html: str, base_url: str = "https://nextjobz.com.bd") -> list[RawJob]:
        """Parse search results page for jobs.

        Job cards are <a> tags pointing to /jobs/<slug>-IJOB<number>.
        Each <a> wraps its own card content (title, subtitle, metadata).
        Stops parsing if "No jobs found" is detected.
        """
        soup = BeautifulSoup(html, "html.parser")
        jobs: list[RawJob] = []

        # Check for "No jobs found" — stop pagination signal
        if self._has_no_results(soup):
            return []

        # Find all anchor tags with /jobs/...-IJOB links
        links = soup.select('a[href*="/jobs/"]')

        for link in links:
            href = link.get("href", "")
            if not href or "-IJOB" not in href:
                continue

            job = self._extract_job_from_card(link, href, base_url)
            if job and job.title and job.url:
                jobs.append(job)

        # Deduplicate
        seen: set[str] = set()
        unique_jobs: list[RawJob] = []
        for j in jobs:
            key = (j.external_job_id, j.url) if j.external_job_id else j.url
            if key not in seen:
                seen.add(key)  # type: ignore[arg-type]
                unique_jobs.append(j)

        return unique_jobs

    def _has_no_results(self, soup: BeautifulSoup) -> bool:
        """Check if the page indicates no results found."""
        empty_selectors = ["[class*='empty']", "[class*='no-jobs']"]
        for sel in empty_selectors:
            if soup.select_one(sel):
                return True
        # Text-based checks — walk all <p> elements
        no_result_texts = ("no jobs found", "no results")
        for p in soup.find_all("p"):
            text = p.get_text(strip=True).lower()
            if any(nr in text for nr in no_result_texts):
                return True
        return False

    def _extract_job_from_card(self, card: Tag, href: str, base_url: str) -> RawJob | None:
        """Extract job data from a card element (the <a> tag wrapping all content)."""
        job = RawJob()

        # URL from the anchor
        job.url = f"{base_url}{href}" if href.startswith("/") else href

        # Extract external_job_id from /jobs/<slug>-IJOB<number>
        match = re.search(r"-IJOB(\d+)", href)
        if match:
            job.external_job_id = f"IJOB{match.group(1)}"

        # Title: <p class="card-title"> inside the <a>
        title_el = card.select_one("p.card-title, [class*='card-title']")
        if title_el:
            job.title = self.clean_text(title_el.get_text(strip=True))

        # Company: <p class="card-subtitle"> inside the <a>
        company_el = card.select_one("p.card-subtitle, [class*='card-subtitle']")
        if company_el:
            job.company = self.clean_text(company_el.get_text(strip=True))

        # Location, experience, type, salary, deadline — metadata divs with SVG icons
        for div in card.find_all("div"):
            if not div.find("svg"):
                continue
            for p in div.find_all("p"):
                text = self.clean_text(p.get_text(strip=True))
                if not text or text == "null":
                    continue
                if self._is_location(text):
                    job.location = text
                elif self._is_salary(text):
                    job.salary = text
                elif self._is_experience(text):
                    pass  # Experience stored in metadata, not in RawJob
                elif self._is_job_type(text):
                    pass  # Job type stored in metadata, not in RawJob
                elif self._looks_like_date(text):
                    pass  # Deadline stored in metadata, not in RawJob

        if job.title and job.url:
            return job

        return None

    def _is_location(self, text: str) -> bool:
        """Check if text looks like a location."""
        geo_keywords = [
            "dhaka", "chittagong", "sylhet", "rajshahi", "khulna",
            "rangpur", "mymensingh", "barisal", "cumilla", "bangladesh",
            "gazipur", "narayanganj",
        ]
        return any(geo in text.lower() for geo in geo_keywords)

    def _is_salary(self, text: str) -> bool:
        """Check if text looks like a salary."""
        return any(sym in text for sym in ["৳", "$", "bdt", "salary"])

    def _is_experience(self, text: str) -> bool:
        """Check if text looks like experience requirement."""
        return any(kw in text.lower() for kw in ["year", "exp"])

    def _is_job_type(self, text: str) -> bool:
        """Check if text looks like employment type."""
        return any(kw in text.lower() for kw in [
            "full-time", "part-time", "contract", "on-site", "remote", "hybrid",
        ])

    def _looks_like_date(self, text: str) -> bool:
        """Check if text looks like a date."""
        date_patterns = [
            r"\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)",
            r"\d{1,2}/\d{1,2}/\d{2,4}",
            r"\d{4}-\d{2}-\d{2}",
            r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}",
        ]
        return any(re.search(p, text, re.IGNORECASE) for p in date_patterns)

    def parse_detail(self, html: str, url: str = "") -> RawJob | None:
        """Parse a job detail page.

        Contains full description, requirements, skills, compensation, company overview.
        Structure: MuiPaper-root MuiCard-root with h1 title, h2 company, tabs, quillPreview.
        """
        soup = BeautifulSoup(html, "html.parser")
        job = RawJob(url=url)

        # Title: <h1 class="MuiTypography-root MuiTypography-h1">
        title_el = soup.select_one("h1.MuiTypography-h1, h1[class*='Typography-h1']")
        if title_el:
            job.title = self.clean_text(title_el.get_text(strip=True))

        # Company: <h2> inside <a href="/company/...">
        company_link = soup.select_one(
            'a[href*="/company/"] h2, a[href*="/company/"] [class*="MuiTypography"]'
        )
        if company_link:
            job.company = self.clean_text(company_link.get_text(strip=True))
        else:
            h2 = soup.select_one("h2.MuiTypography-h2, h2[class*='Typography-h2']")
            if h2:
                job.company = self.clean_text(h2.get_text(strip=True))

        # Location, type, deadline, salary, vacancy from info box
        info_box = None
        for div in soup.find_all("div", class_="MuiBox-root"):
            if div.find("p"):
                info_box = div
                break
        if info_box:
            job.location = self._extract_field_by_label(info_box, "Location")
            job.salary = (
                self._extract_field_by_label(info_box, "Salary")
                or self._extract_field_by_label(info_box, "Compensation")
            )

        # Description: <div class="quillPreview"> or tab section
        desc_el = soup.select_one(
            "div.quillPreview, .ql-editor, [class*='description']:not([class*='job-description'])"
        )
        if desc_el:
            job.description = self.clean_html(str(desc_el))

        if not job.description:
            desc_el = soup.select_one('[class*="job-description"], [class*="Job Description"]')
            if desc_el:
                job.description = self.clean_html(str(desc_el))

        if job.title:
            return job

        return None

    def _extract_field_by_label(self, container: Tag, label: str) -> str | None:
        """Extract a field value by looking for a label followed by a value."""
        for p in container.find_all("p"):
            text = self.clean_text(p.get_text(strip=True))
            if text.lower().startswith(label.lower()):
                return text
        return None
