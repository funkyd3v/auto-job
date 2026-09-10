"""TLS fingerprint impersonation using curl_cffi.

curl_cffi can impersonate real browser TLS handshakes, making
automated requests indistinguishable from legitimate browser traffic.

Supported impersonation targets:
- chrome99, chrome100, chrome101, ..., chrome120
- safari15_3, safari15_5, safari17_0
- firefox99, firefox100, ..., firefox120
"""

from __future__ import annotations

import random
from typing import Any

try:
    from curl_cffi.requests import AsyncSession as CurlAsyncSession
    from curl_cffi.requests import Session as CurlSession

    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False


# Mapping from profile TLS browser to curl_cffi impersonation target
IMPERSONATE_MAP: dict[str, str] = {
    "chrome120": "chrome120",
    "chrome119": "chrome119",
    "chrome118": "chrome118",
    "chrome117": "chrome117",
    "chrome116": "chrome116",
    "chrome115": "chrome115",
    "chrome110": "chrome110",
    "chrome107": "chrome107",
    "chrome104": "chrome104",
    "chrome101": "chrome101",
    "chrome100": "chrome100",
    "chrome99": "chrome99",
    "safari17_0": "safari17_0",
    "safari15_5": "safari15_5",
    "safari15_3": "safari15_3",
    "firefox120": "firefox120",
    "firefox119": "firefox119",
    "firefox117": "firefox117",
    "firefox109": "firefox109",
    "firefox102": "firefox102",
}


def get_impersonate_target(tls_browser: str) -> str:
    """Map a profile's TLS browser string to a curl_cffi impersonation target."""
    return IMPERSONATE_MAP.get(tls_browser, "chrome120")


def create_session(
    impersonate: str | None = None,
    proxy: str | None = None,
    timeout: int = 30,
) -> Any:
    """Create a curl_cffi session with TLS impersonation.

    Args:
        impersonate: Browser to impersonate (e.g., "chrome120").
        proxy: Proxy URL (e.g., "http://user:pass@host:port").
        timeout: Request timeout in seconds.

    Returns:
        curl_cffi Session object.

    Raises:
        ImportError: If curl_cffi is not installed.
    """
    if not HAS_CURL_CFFI:
        raise ImportError(
            "curl_cffi is required for TLS impersonation. "
            "Install with: pip install curl_cffi"
        )

    kwargs: dict[str, Any] = {
        "impersonate": impersonate or "chrome120",
        "timeout": timeout,
    }

    if proxy:
        kwargs["proxy"] = proxy

    return CurlSession(**kwargs)


def create_async_session(
    impersonate: str | None = None,
    proxy: str | None = None,
    timeout: int = 30,
) -> Any:
    """Create an async curl_cffi session with TLS impersonation.

    Args:
        impersonate: Browser to impersonate (e.g., "chrome120").
        proxy: Proxy URL (e.g., "http://user:pass@host:port").
        timeout: Request timeout in seconds.

    Returns:
        curl_cffi AsyncSession object.

    Raises:
        ImportError: If curl_cffi is not installed.
    """
    if not HAS_CURL_CFFI:
        raise ImportError(
            "curl_cffi is required for TLS impersonation. "
            "Install with: pip install curl_cffi"
        )

    kwargs: dict[str, Any] = {
        "impersonate": impersonate or "chrome120",
        "timeout": timeout,
    }

    if proxy:
        kwargs["proxy"] = proxy

    return CurlAsyncSession(**kwargs)


class TLSProfile:
    """Represents a TLS fingerprint profile for a request."""

    def __init__(self, impersonate: str, ja3_hash: str | None = None):
        self.impersonate = impersonate
        self.ja3_hash = ja3_hash

    def __repr__(self) -> str:
        return f"TLSProfile(impersonate={self.impersonate!r})"


# Pre-defined JA3 hashes for common browsers (for reference/logging)
KNOWN_JA3_HASHES = {
    "chrome120": "cd08e31494f9531f560d64c695473da9",
    "chrome119": "b32309a26951912be7dba376398abc3b",
    "safari17_0": "773906b0efdefa24a7f2b8eb6985bf37",
    "firefox120": "a58d5a42f8e89f34a70d23d9b1990bf8",
}


def get_tls_profile(tls_browser: str) -> TLSProfile:
    """Get a TLS profile for the given browser identifier."""
    impersonate = get_impersonate_target(tls_browser)
    ja3 = KNOWN_JA3_HASHES.get(tls_browser)
    return TLSProfile(impersonate=impersonate, ja3_hash=ja3)


def randomize_tls_profile(available_browsers: list[str] | None = None) -> TLSProfile:
    """Select a random TLS profile from available browsers.

    Args:
        available_browsers: List of browser identifiers to choose from.
            Defaults to Chrome variants.

    Returns:
        Randomly selected TLSProfile.
    """
    if available_browsers is None:
        available_browsers = ["chrome120", "chrome119", "chrome118", "chrome117"]

    browser = random.choice(available_browsers)
    return get_tls_profile(browser)
