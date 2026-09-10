"""Base scraper class — orchestrates HTTP fetching, parsing, and timing."""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Any

from ..protocol import RawJob, ScrapeConfig, ScrapeMetadata, ErrorCode
from ..network.client import StealthClient, StealthRequestError
from ..stealth.profiles import BrowserProfile, ProfileManager
from ..stealth import jitter, timing


class BaseScraper(ABC):
    """Base class for job board scrapers.

    Handles the HTTP + timing layer. Subclasses implement
    URL construction and HTML parsing.
    """

    def __init__(
        self,
        client: StealthClient,
        profile_manager: ProfileManager,
    ):
        self.client = client
        self.profiles = profile_manager

    @abstractmethod
    def source_type(self) -> str:
        """Identifier for this scraper (e.g., 'linkedin', 'indeed')."""
        ...

    @abstractmethod
    def build_search_url(self, config: dict[str, Any], page: int = 1) -> str:
        """Construct the search URL from source config."""
        ...

    @abstractmethod
    def parse_search_html(self, html: str, base_url: str) -> list[RawJob]:
        """Parse search results HTML into jobs."""
        ...

    @abstractmethod
    def parse_detail_html(self, html: str, url: str) -> RawJob | None:
        """Parse a job detail page HTML."""
        ...

    @abstractmethod
    def get_detail_url(self, job: RawJob) -> str | None:
        """Get the detail page URL for a job from search results."""
        ...

    async def scrape_search(
        self,
        config: ScrapeConfig,
        search_url: str,
        session_id: str,
        max_pages: int = 3,
    ) -> tuple[list[RawJob], ScrapeMetadata]:
        """Scrape search results with pagination.

        Args:
            config: Scrape configuration.
            search_url: Starting search URL.
            session_id: Session ID for cookie persistence.
            max_pages: Maximum pages to scrape.

        Returns:
            Tuple of (list of jobs, metadata).
        """
        all_jobs: list[RawJob] = []
        start_time = time.monotonic()
        profile = self.profiles.get_for_session(session_id)
        pages_scraped = 0

        for page in range(1, max_pages + 1):
            try:
                # Build page URL
                if page == 1:
                    url = search_url
                else:
                    url = self._build_page_url(search_url, page)

                # Apply timing delay
                if page > 1:
                    await timing.between_pages()

                # Maybe simulate idle browsing
                distraction_url = await jitter.maybe_idle_browse(self._get_base_url())
                if distraction_url:
                    try:
                        await self.client.get(distraction_url, session_id, profile)
                    except StealthRequestError:
                        pass  # Distraction page failure is non-fatal

                # Fetch search page
                html, used_profile = await self.client.get(
                    url, session_id, profile, referer=self._get_base_url()
                )
                profile = used_profile

                # Parse results
                base_url = self._get_base_url()
                jobs = self.parse_search_html(html, base_url)

                if not jobs:
                    # No more results
                    break

                all_jobs.extend(jobs)
                pages_scraped += 1

                # Maybe take a break
                await jitter.maybe_take_break(len(all_jobs))

            except StealthRequestError as e:
                if e.code == ErrorCode.BLOCKED:
                    raise  # Don't continue after block
                # For other errors, try next page
                continue

        duration = int((time.monotonic() - start_time) * 1000)
        metadata = ScrapeMetadata(
            duration=duration,
            profile_used=profile.id,
            pages_scraped=pages_scraped,
        )

        return all_jobs, metadata

    async def scrape_detail(
        self,
        job: RawJob,
        config: ScrapeConfig,
        session_id: str,
    ) -> RawJob | None:
        """Scrape a job detail page for full description.

        Args:
            job: Job from search results.
            config: Scrape configuration.
            session_id: Session ID.

        Returns:
            Updated RawJob with full details, or None if failed.
        """
        detail_url = self.get_detail_url(job)
        if not detail_url:
            return None

        try:
            profile = self.profiles.get_for_session(session_id)
            referer = self._get_base_url()

            html, _ = await self.client.get(
                detail_url, session_id, profile, referer=referer
            )

            detail_job = self.parse_detail_html(html, detail_url)
            if detail_job:
                # Merge search data with detail data
                return self._merge_jobs(job, detail_job)

            return job  # Return original if parse fails

        except StealthRequestError:
            return job  # Return original on error

    async def scrape_detail_batch(
        self,
        jobs: list[RawJob],
        config: ScrapeConfig,
        session_id: str,
    ) -> list[RawJob]:
        """Scrape detail pages for multiple jobs with timing."""
        results: list[RawJob] = []

        for job in jobs:
            detail = await self.scrape_detail(job, config, session_id)
            if detail:
                results.append(detail)
            else:
                results.append(job)

        return results

    def _build_page_url(self, base_url: str, page: int) -> str:
        """Build paginated URL. Override for custom pagination."""
        separator = "&" if "?" in base_url else "?"
        return f"{base_url}{separator}start={25 * (page - 1)}"

    @abstractmethod
    def _get_base_url(self) -> str:
        """Get the base URL for this source."""
        ...

    @staticmethod
    def _merge_jobs(search_job: RawJob, detail_job: RawJob) -> RawJob:
        """Merge search result data with detail page data."""
        return RawJob(
            external_job_id=detail_job.external_job_id or search_job.external_job_id,
            title=detail_job.title or search_job.title,
            company=detail_job.company or search_job.company,
            location=detail_job.location or search_job.location,
            url=detail_job.url or search_job.url,
            description=detail_job.description if len(detail_job.description) > len(search_job.description) else search_job.description,
            salary=detail_job.salary or search_job.salary,
            scraped_at=detail_job.scraped_at or search_job.scraped_at,
        )
