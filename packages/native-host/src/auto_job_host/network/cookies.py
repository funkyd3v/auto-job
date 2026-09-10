"""Persistent cookie jar for session management.

Maintains cookies across requests within a session,
simulating a real browser's cookie behavior.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Cookie:
    """A single cookie."""

    name: str
    value: str
    domain: str
    path: str = "/"
    expires: float | None = None
    http_only: bool = False
    secure: bool = False
    same_site: str = "Lax"

    @property
    def is_expired(self) -> bool:
        if self.expires is None:
            return False
        return time.time() > self.expires

    def to_header(self) -> str:
        return f"{self.name}={self.value}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "value": self.value,
            "domain": self.domain,
            "path": self.path,
            "expires": self.expires,
            "http_only": self.http_only,
            "secure": self.secure,
            "same_site": self.same_site,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Cookie:
        return cls(**data)


class CookieJar:
    """Persistent cookie jar with domain scoping.

    Stores cookies in memory and optionally persists to disk.
    """

    def __init__(self, session_id: str, storage_dir: Path | None = None):
        self.session_id = session_id
        self._cookies: dict[str, Cookie] = {}  # key: "domain|path|name"
        self._storage_dir = storage_dir

        if storage_dir:
            self._load()

    def _key(self, cookie: Cookie) -> str:
        return f"{cookie.domain}|{cookie.path}|{cookie.name}"

    def _load(self) -> None:
        """Load cookies from disk."""
        if self._storage_dir is None:
            return

        cookie_file = self._storage_dir / f"cookies_{self.session_id}.json"
        if not cookie_file.exists():
            return

        try:
            data = json.loads(cookie_file.read_text())
            for cookie_data in data:
                cookie = Cookie.from_dict(cookie_data)
                if not cookie.is_expired:
                    self._cookies[self._key(cookie)] = cookie
        except (json.JSONDecodeError, KeyError):
            pass

    def _save(self) -> None:
        """Persist cookies to disk."""
        if self._storage_dir is None:
            return

        self._storage_dir.mkdir(parents=True, exist_ok=True)
        cookie_file = self._storage_dir / f"cookies_{self.session_id}.json"

        # Only save non-expired cookies
        valid = [c.to_dict() for c in self._cookies.values() if not c.is_expired]
        cookie_file.write_text(json.dumps(valid, indent=2))

    def update(self, cookies: dict[str, str], domain: str) -> None:
        """Update cookies from a response.

        Args:
            cookies: Dict of name=value pairs from response.
            domain: Domain the cookies belong to.
        """
        for name, value in cookies.items():
            cookie = Cookie(name=name, value=value, domain=domain)
            self._cookies[self._key(cookie)] = cookie

        self._save()

    def parse_set_cookie(self, header_value: str, domain: str) -> None:
        """Parse a Set-Cookie header and add to jar.

        Args:
            header_value: Value of Set-Cookie header.
            domain: Domain from the response.
        """
        parts = header_value.split(";")
        if not parts:
            return

        name_value = parts[0].strip()
        if "=" not in name_value:
            return

        name, value = name_value.split("=", 1)

        cookie = Cookie(name=name.strip(), value=value.strip(), domain=domain)

        for part in parts[1:]:
            part = part.strip().lower()
            if part.startswith("expires="):
                try:
                    # Simple timestamp parsing
                    cookie.expires = time.time() + 86400  # Default 24h
                except ValueError:
                    pass
            elif part.startswith("path="):
                cookie.path = part.split("=", 1)[1]
            elif part == "httponly":
                cookie.http_only = True
            elif part == "secure":
                cookie.secure = True
            elif part.startswith("samesite="):
                cookie.same_site = part.split("=", 1)[1].title()

        self._cookies[self._key(cookie)] = cookie
        self._save()

    def get_cookie_header(self, domain: str, path: str = "/") -> str:
        """Get Cookie header value for a request.

        Args:
            domain: Request domain.
            path: Request path.

        Returns:
            Cookie header string (e.g., "name1=val1; name2=val2").
        """
        matching = []
        for cookie in self._cookies.values():
            if cookie.is_expired:
                continue
            if cookie.domain != domain:
                continue
            if not path.startswith(cookie.path):
                continue
            matching.append(cookie.to_header())

        return "; ".join(matching)

    def clear(self) -> None:
        """Clear all cookies."""
        self._cookies.clear()
        self._save()

    def clear_expired(self) -> int:
        """Remove expired cookies.

        Returns:
            Number of cookies removed.
        """
        before = len(self._cookies)
        self._cookies = {k: v for k, v in self._cookies.items() if not v.is_expired}
        self._save()
        return before - len(self._cookies)

    @property
    def count(self) -> int:
        return len(self._cookies)
