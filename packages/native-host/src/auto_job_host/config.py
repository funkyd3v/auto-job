"""Configuration for the native host."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Config:
    """Native host configuration."""

    # Logging
    log_level: str = "INFO"

    # Profile management
    profiles_dir: Path | None = None

    # Proxy settings
    proxy_url: str | None = None  # http://user:pass@host:port
    proxy_file: Path | None = None  # File with one proxy per line

    # Timing
    min_delay_ms: int = 800
    max_delay_ms: int = 2500
    page_delay_ms: int = 3000

    # Limits
    max_pages_per_search: int = 3
    max_jobs_per_page: int = 25
    request_timeout: int = 30

    # Cookie persistence
    cookie_storage_dir: Path | None = None

    # Browser cookies file (EditThisCookie JSON export)
    cookies_file: Path | None = None

    # Session
    session_id: str = "default"

    @classmethod
    def from_env(cls) -> Config:
        """Load configuration from environment variables."""
        config = cls()

        if val := os.environ.get("AUTOJOB_LOG_LEVEL"):
            config.log_level = val

        if val := os.environ.get("AUTOJOB_PROFILES_DIR"):
            config.profiles_dir = Path(val)

        if val := os.environ.get("AUTOJOB_PROXY"):
            config.proxy_url = val

        if val := os.environ.get("AUTOJOB_PROXY_FILE"):
            config.proxy_file = Path(val)

        if val := os.environ.get("AUTOJOB_MIN_DELAY_MS"):
            config.min_delay_ms = int(val)

        if val := os.environ.get("AUTOJOB_MAX_DELAY_MS"):
            config.max_delay_ms = int(val)

        if val := os.environ.get("AUTOJOB_MAX_PAGES"):
            config.max_pages_per_search = int(val)

        if val := os.environ.get("AUTOJOB_TIMEOUT"):
            config.request_timeout = int(val)

        if val := os.environ.get("AUTOJOB_COOKIE_DIR"):
            config.cookie_storage_dir = Path(val)

        return config

    @classmethod
    def from_file(cls, path: Path) -> Config:
        """Load configuration from a JSON file."""
        if not path.exists():
            return cls()

        data = json.loads(path.read_text())
        config = cls()

        for key, value in data.items():
            if hasattr(config, key):
                # Convert Path fields
                if key.endswith("_dir") or key.endswith("_file"):
                    if value is not None:
                        value = Path(value)
                setattr(config, key, value)

        return config

    def get_proxies(self) -> list[str]:
        """Get list of proxy URLs from config."""
        proxies = []
        if self.proxy_url:
            proxies.append(self.proxy_url)
        if self.proxy_file and self.proxy_file.exists():
            for line in self.proxy_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    proxies.append(line)
        return proxies
