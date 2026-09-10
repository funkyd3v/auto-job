"""Proxy pool management with rotation and health monitoring.

Supports residential rotating proxies with automatic failover.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ProxyConfig:
    """Configuration for a single proxy."""

    host: str
    port: int
    username: str | None = None
    password: str | None = None
    protocol: str = "http"

    # Health tracking
    failure_count: int = 0
    last_failure: float = 0.0
    last_success: float = 0.0
    is_healthy: bool = True

    @property
    def url(self) -> str:
        auth = f"{self.username}:{self.password}@" if self.username else ""
        return f"{self.protocol}://{auth}{self.host}:{self.port}"

    @property
    def key(self) -> str:
        return f"{self.host}:{self.port}"

    def mark_success(self) -> None:
        self.failure_count = 0
        self.last_success = time.time()
        self.is_healthy = True

    def mark_failure(self) -> None:
        self.failure_count += 1
        self.last_failure = time.time()
        # Mark unhealthy after 3 consecutive failures
        if self.failure_count >= 3:
            self.is_healthy = False

    @property
    def cooldown_remaining(self) -> float:
        """Seconds until this proxy exits cooldown (60s after failure)."""
        if self.is_healthy:
            return 0.0
        elapsed = time.time() - self.last_failure
        return max(0.0, 60.0 - elapsed)


class ProxyPool:
    """Manages a pool of proxies with rotation and health tracking."""

    def __init__(self, proxies: list[ProxyConfig] | None = None):
        self._proxies: list[ProxyConfig] = proxies or []
        self._current_index = 0
        self._session_proxy: dict[str, ProxyConfig] = {}  # session_id → proxy

    def add(self, proxy: ProxyConfig) -> None:
        """Add a proxy to the pool."""
        if not any(p.key == proxy.key for p in self._proxies):
            self._proxies.append(proxy)

    def get_next(self) -> ProxyConfig | None:
        """Get the next healthy proxy in rotation.

        Returns:
            ProxyConfig or None if no healthy proxies available.
        """
        healthy = [p for p in self._proxies if p.is_healthy or p.cooldown_remaining <= 0]
        if not healthy:
            return None

        proxy = healthy[self._current_index % len(healthy)]
        self._current_index += 1
        return proxy

    def get_for_session(self, session_id: str) -> ProxyConfig | None:
        """Get a consistent proxy for a session.

        Args:
            session_id: Session identifier.

        Returns:
            ProxyConfig for this session, or None.
        """
        if session_id not in self._session_proxy:
            proxy = self.get_next()
            if proxy:
                self._session_proxy[session_id] = proxy
        return self._session_proxy.get(session_id)

    def release_session(self, session_id: str) -> None:
        """Release a session's proxy."""
        self._session_proxy.pop(session_id, None)

    def mark_success(self, proxy: ProxyConfig) -> None:
        """Mark a proxy as successful."""
        proxy.mark_success()

    def mark_failure(self, proxy: ProxyConfig) -> None:
        """Mark a proxy as failed."""
        proxy.mark_failure()

    @property
    def healthy_count(self) -> int:
        return len([p for p in self._proxies if p.is_healthy])

    @property
    def total_count(self) -> int:
        return len(self._proxies)

    def get_stats(self) -> dict[str, Any]:
        return {
            "total": self.total_count,
            "healthy": self.healthy_count,
            "sessions": len(self._session_proxy),
        }


def parse_proxy_string(proxy_str: str) -> ProxyConfig:
    """Parse a proxy URL string into ProxyConfig.

    Supports formats:
    - http://host:port
    - http://user:pass@host:port
    - host:port
    - host:port:user:pass
    """
    if "://" in proxy_str:
        # URL format
        parts = proxy_str.split("://", 1)
        protocol = parts[0]
        rest = parts[1]

        username = None
        password = None
        if "@" in rest:
            auth, host_part = rest.rsplit("@", 1)
            if ":" in auth:
                username, password = auth.split(":", 1)
            else:
                username = auth
            rest = host_part

        host, port = rest.split(":", 1)
        return ProxyConfig(
            host=host,
            port=int(port),
            username=username,
            password=password,
            protocol=protocol,
        )
    else:
        # Simple format: host:port or host:port:user:pass
        parts = proxy_str.split(":")
        if len(parts) == 4:
            return ProxyConfig(
                host=parts[0],
                port=int(parts[1]),
                username=parts[2],
                password=parts[3],
            )
        elif len(parts) == 2:
            return ProxyConfig(host=parts[0], port=int(parts[1]))
        else:
            raise ValueError(f"Invalid proxy format: {proxy_str}")
