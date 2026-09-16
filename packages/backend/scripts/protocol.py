"""Data models for the standalone scraper.

Simplified from the Chrome Native Messaging protocol.
Contains only dataclasses needed for scraping — no stdin/stdout I/O.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RawJob:
    external_job_id: str | None = None
    title: str = ""
    company: str = ""
    location: str | None = None
    url: str = ""
    description: str = ""
    salary: str | None = None
    scraped_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "external_job_id": self.external_job_id,
            "title": self.title,
            "company": self.company,
            "location": self.location,
            "url": self.url,
            "description": self.description,
            "salary": self.salary,
            "scraped_at": self.scraped_at,
        }


@dataclass
class ScrapeMetadata:
    duration: int = 0
    profile_used: str = ""
    pages_scraped: int = 0


@dataclass
class ScrapeConfig:
    keywords: list[str] = field(default_factory=list)
    location: str | None = None
    max_pages: int = 3
