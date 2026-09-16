"""HTML parser base class for job board scraping."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod

from protocol import RawJob


class BaseParser(ABC):
    """Base class for HTML parsers."""

    @abstractmethod
    def parse_search(self, html: str, base_url: str) -> list[RawJob]:
        """Parse a search results page.

        Args:
            html: Raw HTML content.
            base_url: Base URL for resolving relative links.

        Returns:
            List of RawJob objects.
        """
        ...

    @abstractmethod
    def parse_detail(self, html: str, url: str) -> RawJob | None:
        """Parse a job detail page.

        Args:
            html: Raw HTML content.
            url: URL of the detail page.

        Returns:
            RawJob or None if parsing fails.
        """
        ...

    @staticmethod
    def clean_text(text: str | None, max_length: int | None = None) -> str:
        """Clean extracted text content."""
        if not text:
            return ""
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", text)
        if max_length and len(text) > max_length:
            text = text[:max_length]
        return text

    @staticmethod
    def clean_html(html: str | None) -> str:
        """Clean HTML content while preserving structure."""
        if not html:
            return ""
        html = re.sub(
            r"<\s*(script|iframe|object|embed|form|style)[^>]*>[\s\S]*?<\s*/\s*\1\s*>",
            "",
            html,
            flags=re.IGNORECASE,
        )
        html = re.sub(
            r"\s*on\w+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)",
            "",
            html,
            flags=re.IGNORECASE,
        )
        html = re.sub(r"javascript\s*:", "", html, flags=re.IGNORECASE)
        return html.strip()
