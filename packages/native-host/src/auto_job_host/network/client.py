"""Stealth HTTP client with TLS fingerprint impersonation.

Combines all stealth modules into a single client that handles:
- TLS fingerprint impersonation via curl_cffi
- Browser profile header rotation
- Human-like request timing
- Cookie persistence
- Proxy rotation
- Error detection and retry logic
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from ..protocol import ErrorCode
from ..stealth.profiles import BrowserProfile, ProfileManager
from ..stealth import timing
from ..stealth.headers import build_headers, strip_extension_headers, randomize_header_values
from ..stealth.tls import get_impersonate_target, HAS_CURL_CFFI
from .cookies import CookieJar
from .proxy import ProxyConfig, ProxyPool


class StealthRequestError(Exception):
    """Error during stealth HTTP request."""

    def __init__(self, code: ErrorCode, message: str, retryable: bool = False, retry_after: int | None = None):
        self.code = code
        self.message = message
        self.retryable = retryable
        self.retry_after = retry_after
        super().__init__(message)


class StealthClient:
    """HTTP client that mimics real browser behavior.

    Uses curl_cffi for TLS impersonation and manages:
    - Browser profile rotation
    - Header construction
    - Cookie persistence
    - Request timing
    - Proxy failover
    """

    def __init__(
        self,
        profile_manager: ProfileManager,
        proxy_pool: ProxyPool | None = None,
        cookie_storage_dir: Any = None,
        cookies_file: str | None = None,
    ):
        self.profiles = profile_manager
        self.proxy_pool = proxy_pool
        self._cookie_jars: dict[str, CookieJar] = {}
        self._cookie_storage_dir = cookie_storage_dir
        self._browser_cookies: dict[str, str] = {}  # domain -> cookie header string

        if cookies_file:
            self._load_cookies_file(cookies_file)

    def _load_cookies_file(self, path: str) -> None:
        """Load cookies from EditThisCookie JSON export or Netscape format."""
        import json
        import sys
        from pathlib import Path

        cookie_path = Path(path)
        if not cookie_path.exists():
            print(f"[WARN] Cookies file not found: {path}", file=sys.stderr, flush=True)
            return

        try:
            content = cookie_path.read_text()
            data = json.loads(content)

            if isinstance(data, list):
                # EditThisCookie JSON format
                cookie_parts = []
                for c in data:
                    name = c.get("name", "")
                    value = c.get("value", "")
                    if name and value:
                        cookie_parts.append(f"{name}={value}")
                self._browser_cookies[".linkedin.com"] = "; ".join(cookie_parts)
                print(f"[INFO] Loaded {len(data)} cookies from {path}", file=sys.stderr, flush=True)
            else:
                print(f"[WARN] Unknown cookie format in {path}", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"[ERROR] Failed to load cookies: {e}", file=sys.stderr, flush=True)

    def _get_cookie_jar(self, session_id: str) -> CookieJar:
        if session_id not in self._cookie_jars:
            self._cookie_jars[session_id] = CookieJar(session_id, self._cookie_storage_dir)
        return self._cookie_jars[session_id]

    async def get(
        self,
        url: str,
        session_id: str = "default",
        profile: BrowserProfile | None = None,
        proxy: ProxyConfig | None = None,
        referer: str | None = None,
        timeout: int = 30,
        extra_headers: dict[str, str] | None = None,
    ) -> tuple[str, BrowserProfile]:
        """Make a stealth GET request.

        Args:
            url: URL to fetch.
            session_id: Session identifier for cookie persistence.
            profile: Browser profile (random if not specified).
            proxy: Proxy to use (from pool if not specified).
            referer: Referer header.
            timeout: Request timeout in seconds.
            extra_headers: Additional headers.

        Returns:
            Tuple of (response_html, profile_used).

        Raises:
            StealthRequestError: On blocked, rate limited, or network errors.
        """
        if not HAS_CURL_CFFI:
            raise StealthRequestError(
                code=ErrorCode.HOST_ERROR,
                message="curl_cffi not installed. Run: pip install curl_cffi",
                retryable=False,
            )

        # Select profile
        if profile is None:
            profile = self.profiles.get_for_session(session_id)

        # Select proxy
        if proxy is None and self.proxy_pool:
            proxy = self.proxy_pool.get_for_session(session_id)

        # Build headers
        headers = build_headers(profile, referer, extra_headers)
        headers = strip_extension_headers(headers)
        headers = randomize_header_values(headers, profile)

        # Get cookies for domain
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.hostname or ""

        # Combine browser cookies (from file) with session cookies
        cookie_parts = []

        # Browser cookies from file (highest priority)
        for cookie_domain, cookie_str in self._browser_cookies.items():
            if domain.endswith(cookie_domain.lstrip(".")):
                cookie_parts.append(cookie_str)

        # Session cookies from jar
        session_cookies = self._get_cookie_jar(session_id).get_cookie_header(domain)
        if session_cookies:
            cookie_parts.append(session_cookies)

        if cookie_parts:
            headers["Cookie"] = "; ".join(cookie_parts)

        # Apply timing delay
        await timing.between_requests()

        # Make request with curl_cffi
        start_time = time.monotonic()
        try:
            import sys
            from curl_cffi.requests import AsyncSession

            impersonate = get_impersonate_target(profile.tls_browser)
            proxy_url = proxy.url if proxy else None

            print(f"[DEBUG] curl_cffi impersonate={impersonate}, profile={profile.id}", file=sys.stderr, flush=True)
            print(f"[DEBUG] Headers: {list(headers.keys())}", file=sys.stderr, flush=True)

            async with AsyncSession(
                impersonate=impersonate,
                timeout=timeout,
                proxy=proxy_url,
            ) as session:
                response = await session.get(url, headers=headers)

                print(f"[DEBUG] Response status={response.status_code}, len={len(response.text)}", file=sys.stderr, flush=True)

                # Debug: save response for inspection
                debug_path = f"/tmp/autojob_response_{response.status_code}.html"
                with open(debug_path, "w", encoding="utf-8") as f:
                    f.write(response.text)
                print(f"[DEBUG] Saved response to {debug_path}", file=sys.stderr, flush=True)

                # Parse cookies from response
                for name, value in response.cookies.items():
                    self._get_cookie_jar(session_id).update({name: value}, domain)

                # Parse Set-Cookie headers
                for header_value in response.headers.get_list("set-cookie"):
                    self._get_cookie_jar(session_id).parse_set_cookie(header_value, domain)

                # Check for bot detection
                status = response.status_code
                text = response.text

                if status == 403:
                    raise StealthRequestError(
                        code=ErrorCode.BLOCKED,
                        message=f"Blocked (403) on {url}",
                        retryable=True,
                        retry_after=300,
                    )
                elif status == 429:
                    retry_after = int(response.headers.get("Retry-After", "60"))
                    raise StealthRequestError(
                        code=ErrorCode.RATE_LIMITED,
                        message=f"Rate limited (429) on {url}",
                        retryable=True,
                        retry_after=retry_after,
                    )
                elif status >= 500:
                    raise StealthRequestError(
                        code=ErrorCode.NETWORK_ERROR,
                        message=f"Server error ({status}) on {url}",
                        retryable=True,
                        retry_after=30,
                    )
                elif status != 200:
                    raise StealthRequestError(
                        code=ErrorCode.NETWORK_ERROR,
                        message=f"HTTP {status} on {url}",
                        retryable=status < 400,
                    )

                # Check for LinkedIn verification page
                if "checkpoint" in text.lower() or "verify" in text.lower():
                    raise StealthRequestError(
                        code=ErrorCode.BLOCKED,
                        message="Verification page detected",
                        retryable=True,
                        retry_after=600,
                    )

                duration = int((time.monotonic() - start_time) * 1000)
                if proxy:
                    proxy.mark_success()

                return text, profile

        except StealthRequestError:
            raise
        except Exception as e:
            if proxy:
                proxy.mark_failure()
            raise StealthRequestError(
                code=ErrorCode.NETWORK_ERROR,
                message=f"Request failed: {e}",
                retryable=True,
                retry_after=30,
            )

    async def close(self) -> None:
        """Clean up resources."""
        self._cookie_jars.clear()
