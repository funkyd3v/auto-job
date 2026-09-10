"""Browser fingerprint profiles for TLS and header impersonation.

Each profile defines a complete browser identity:
- TLS fingerprint (JA3 hash, ALPN protocols, etc.)
- HTTP header ordering and values
- Client hints (sec-ch-ua)
- Accept-Language patterns

Profiles are loaded from JSON files in the profiles/ directory.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class BrowserProfile:
    """Complete browser fingerprint for impersonation."""

    id: str
    name: str
    tls_browser: str  # curl_cffi impersonation target (chrome120, safari17, etc.)

    # HTTP headers in native browser order
    headers: dict[str, str] = field(default_factory=dict)
    header_order: list[str] = field(default_factory=list)

    # Client hints
    sec_ch_ua: str = ""
    sec_ch_ua_mobile: str = "?0"
    sec_ch_ua_platform: str = ""

    # Accept values
    accept: str = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    accept_language: str = "en-US,en;q=0.9"
    accept_encoding: str = "gzip, deflate, br"

    # Viewport hints
    viewport_width: int = 1920
    viewport_height: int = 1080
    device_memory: int = 8
    hardware_concurrency: int = 8

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> BrowserProfile:
        return cls(
            id=data["id"],
            name=data["name"],
            tls_browser=data["tls_browser"],
            headers=data.get("headers", {}),
            header_order=data.get("header_order", []),
            sec_ch_ua=data.get("sec_ch_ua", ""),
            sec_ch_ua_mobile=data.get("sec_ch_ua_mobile", "?0"),
            sec_ch_ua_platform=data.get("sec_ch_ua_platform", ""),
            accept=data.get("accept", cls.accept),
            accept_language=data.get("accept_language", cls.accept_language),
            accept_encoding=data.get("accept_encoding", cls.accept_encoding),
            viewport_width=data.get("viewport_width", 1920),
            viewport_height=data.get("viewport_height", 1080),
            device_memory=data.get("device_memory", 8),
            hardware_concurrency=data.get("hardware_concurrency", 8),
        )

    def get_ordered_headers(self) -> dict[str, str]:
        """Return headers in this profile's native ordering."""
        if self.header_order:
            ordered: dict[str, str] = {}
            # First add headers in specified order
            for key in self.header_order:
                if key in self.headers:
                    ordered[key] = self.headers[key]
            # Then add any remaining headers
            for key, value in self.headers.items():
                if key not in ordered:
                    ordered[key] = value
            return ordered
        return dict(self.headers)


class ProfileManager:
    """Manages browser fingerprint profiles with random selection."""

    def __init__(self, profiles_dir: Path | None = None):
        self.profiles: list[BrowserProfile] = []
        self._session_cache: dict[str, BrowserProfile] = {}

        if profiles_dir is None:
            profiles_dir = Path(__file__).parent.parent.parent / "profiles"

        self._load_profiles(profiles_dir)

    def _load_profiles(self, profiles_dir: Path) -> None:
        """Load all profile JSON files from the profiles directory."""
        if not profiles_dir.exists():
            # Fall back to built-in defaults
            self.profiles = _get_default_profiles()
            return

        for profile_file in sorted(profiles_dir.glob("*.json")):
            try:
                data = json.loads(profile_file.read_text())
                self.profiles.append(BrowserProfile.from_dict(data))
            except (json.JSONDecodeError, KeyError) as e:
                print(f"[ProfileManager] skipping {profile_file.name}: {e}")

        if not self.profiles:
            self.profiles = _get_default_profiles()

    def get_random(self) -> BrowserProfile:
        """Get a random profile for a new session."""
        return random.choice(self.profiles)

    def get_for_session(self, session_id: str) -> BrowserProfile:
        """Get a consistent profile for a session (same session = same profile)."""
        if session_id not in self._session_cache:
            self._session_cache[session_id] = self.get_random()
        return self._session_cache[session_id]

    def release_session(self, session_id: str) -> None:
        """Release a session's profile."""
        self._session_cache.pop(session_id, None)

    @property
    def count(self) -> int:
        return len(self.profiles)


def _get_default_profiles() -> list[BrowserProfile]:
    """Built-in fallback profiles when JSON files are not available."""
    return [
        BrowserProfile(
            id="chrome_120_linux",
            name="Chrome 120 (Linux)",
            tls_browser="chrome120",
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "Accept-Encoding": "gzip, deflate, br",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "max-age=0",
                "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Linux"',
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            header_order=[
                "Host",
                "Connection",
                "Cache-Control",
                "Upgrade-Insecure-Requests",
                "User-Agent",
                "Accept",
                "Sec-Fetch-Site",
                "Sec-Fetch-Mode",
                "Sec-Fetch-User",
                "Sec-Fetch-Dest",
                "Accept-Encoding",
                "Accept-Language",
                "Sec-Ch-Ua",
                "Sec-Ch-Ua-Mobile",
                "Sec-Ch-Ua-Platform",
                "Cookie",
            ],
            sec_ch_ua='"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            sec_ch_ua_platform='"Linux"',
            viewport_width=1920,
            viewport_height=1080,
            device_memory=8,
            hardware_concurrency=8,
        ),
        BrowserProfile(
            id="chrome_120_windows",
            name="Chrome 120 (Windows)",
            tls_browser="chrome120",
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "Accept-Encoding": "gzip, deflate, br",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "max-age=0",
                "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"',
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            header_order=[
                "Host",
                "Connection",
                "Cache-Control",
                "Upgrade-Insecure-Requests",
                "User-Agent",
                "Accept",
                "Sec-Fetch-Site",
                "Sec-Fetch-Mode",
                "Sec-Fetch-User",
                "Sec-Fetch-Dest",
                "Accept-Encoding",
                "Accept-Language",
                "Sec-Ch-Ua",
                "Sec-Ch-Ua-Mobile",
                "Sec-Ch-Ua-Platform",
                "Cookie",
            ],
            sec_ch_ua='"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            sec_ch_ua_platform='"Windows"',
            viewport_width=1920,
            viewport_height=1080,
            device_memory=8,
            hardware_concurrency=8,
        ),
        BrowserProfile(
            id="chrome_120_mac",
            name="Chrome 120 (macOS)",
            tls_browser="chrome120",
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
                "Accept-Encoding": "gzip, deflate, br",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "max-age=0",
                "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"macOS"',
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            header_order=[
                "Host",
                "Connection",
                "Cache-Control",
                "Upgrade-Insecure-Requests",
                "User-Agent",
                "Accept",
                "Sec-Fetch-Site",
                "Sec-Fetch-Mode",
                "Sec-Fetch-User",
                "Sec-Fetch-Dest",
                "Accept-Encoding",
                "Accept-Language",
                "Sec-Ch-Ua",
                "Sec-Ch-Ua-Mobile",
                "Sec-Ch-Ua-Platform",
                "Cookie",
            ],
            sec_ch_ua='"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            sec_ch_ua_platform='"macOS"',
            viewport_width=1440,
            viewport_height=900,
            device_memory=8,
            hardware_concurrency=10,
        ),
        BrowserProfile(
            id="safari_17_mac",
            name="Safari 17 (macOS)",
            tls_browser="safari17",
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
            },
            header_order=[
                "Host",
                "Accept",
                "Sec-Fetch-Site",
                "Cookie",
                "Sec-Fetch-Mode",
                "Accept-Language",
                "User-Agent",
                "Accept-Encoding",
                "Sec-Fetch-Dest",
            ],
            accept="text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            accept_language="en-US,en;q=0.9",
            viewport_width=1440,
            viewport_height=900,
            device_memory=8,
            hardware_concurrency=10,
        ),
        BrowserProfile(
            id="firefox_121_windows",
            name="Firefox 121 (Windows)",
            tls_browser="firefox120",
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Accept-Language": "en-US,en;q=0.5",
                "Connection": "keep-alive",
                "DNT": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
            },
            header_order=[
                "Host",
                "User-Agent",
                "Accept",
                "Accept-Language",
                "Accept-Encoding",
                "Connection",
                "DNT",
                "Upgrade-Insecure-Requests",
                "Sec-Fetch-Dest",
                "Sec-Fetch-Mode",
                "Sec-Fetch-Site",
                "Sec-Fetch-User",
                "Cookie",
            ],
            accept="text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            accept_language="en-US,en;q=0.5",
            viewport_width=1920,
            viewport_height=1080,
            device_memory=8,
            hardware_concurrency=8,
        ),
    ]
