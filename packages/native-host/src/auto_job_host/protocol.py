"""Chrome Native Messaging protocol — length-prefixed JSON over stdin/stdout.

Chrome Native Messaging format:
  - 4 bytes: uint32 little-endian message length
  - N bytes: UTF-8 JSON payload

Maximum message size: 1 MB (Chrome limit).
"""

from __future__ import annotations

import json
import struct
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Literal, Union


# ─── Constants ────────────────────────────────────────────────────────────────

MAX_MESSAGE_SIZE = 1 * 1024 * 1024  # 1 MB Chrome limit
HEADER_SIZE = 4  # uint32


# ─── Enums ────────────────────────────────────────────────────────────────────

class MessageType(str, Enum):
    # Extension → Host
    SCRAPE_SEARCH = "SCRAPE_SEARCH"
    SCRAPE_DETAIL = "SCRAPE_DETAIL"
    PING = "PING"
    SHUTDOWN = "SHUTDOWN"

    # Host → Extension
    SEARCH_RESULT = "SEARCH_RESULT"
    DETAIL_RESULT = "DETAIL_RESULT"
    PROGRESS = "PROGRESS"
    PONG = "PONG"
    ERROR = "ERROR"


class ErrorCode(str, Enum):
    BLOCKED = "BLOCKED"
    RATE_LIMITED = "RATE_LIMITED"
    PARSE_ERROR = "PARSE_ERROR"
    NETWORK_ERROR = "NETWORK_ERROR"
    CONFIG_ERROR = "CONFIG_ERROR"
    HOST_ERROR = "HOST_ERROR"


# ─── Data Classes ─────────────────────────────────────────────────────────────

@dataclass
class ProxyConfig:
    host: str
    port: int
    username: str | None = None
    password: str | None = None

    def to_url(self) -> str:
        auth = f"{self.username}:{self.password}@" if self.username else ""
        return f"http://{auth}{self.host}:{self.port}"


@dataclass
class ScrapeConfig:
    max_pages: int = 3
    proxy: ProxyConfig | None = None
    cookie_session: str | None = None
    timeout: int = 30


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
    duration: int = 0  # milliseconds
    profile_used: str = ""
    pages_scraped: int = 0
    proxy_used: str | None = None


# ─── Message Types ────────────────────────────────────────────────────────────

@dataclass
class ScrapeSearchMessage:
    type: Literal["SCRAPE_SEARCH"] = "SCRAPE_SEARCH"
    payload: dict[str, Any] = field(default_factory=dict)

    @property
    def source(self) -> str:
        return self.payload.get("source", "")

    @property
    def url(self) -> str:
        return self.payload.get("url", "")

    @property
    def config(self) -> ScrapeConfig:
        c = self.payload.get("config", {})
        proxy_data = c.get("proxy")
        proxy = None
        if proxy_data:
            proxy = ProxyConfig(
                host=proxy_data["host"],
                port=proxy_data["port"],
                username=proxy_data.get("username"),
                password=proxy_data.get("password"),
            )
        return ScrapeConfig(
            max_pages=c.get("max_pages", 3),
            proxy=proxy,
            cookie_session=c.get("cookie_session"),
            timeout=c.get("timeout", 30),
        )


@dataclass
class ScrapeDetailMessage:
    type: Literal["SCRAPE_DETAIL"] = "SCRAPE_DETAIL"
    payload: dict[str, Any] = field(default_factory=dict)

    @property
    def source(self) -> str:
        return self.payload.get("source", "")

    @property
    def url(self) -> str:
        return self.payload.get("url", "")

    @property
    def config(self) -> ScrapeConfig:
        c = self.payload.get("config", {})
        proxy_data = c.get("proxy")
        proxy = None
        if proxy_data:
            proxy = ProxyConfig(
                host=proxy_data["host"],
                port=proxy_data["port"],
                username=proxy_data.get("username"),
                password=proxy_data.get("password"),
            )
        return ScrapeConfig(
            max_pages=c.get("max_pages", 1),
            proxy=proxy,
            cookie_session=c.get("cookie_session"),
            timeout=c.get("timeout", 30),
        )


@dataclass
class PingMessage:
    type: Literal["PING"] = "PING"
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class ShutdownMessage:
    type: Literal["SHUTDOWN"] = "SHUTDOWN"
    payload: dict[str, Any] = field(default_factory=dict)


# ─── Response Messages ────────────────────────────────────────────────────────

@dataclass
class SearchResultMessage:
    jobs: list[RawJob]
    metadata: ScrapeMetadata

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "SEARCH_RESULT",
            "payload": {
                "jobs": [j.to_dict() for j in self.jobs],
                "metadata": {
                    "duration": self.metadata.duration,
                    "profile_used": self.metadata.profile_used,
                    "pages_scraped": self.metadata.pages_scraped,
                    "proxy_used": self.metadata.proxy_used,
                },
            },
        }


@dataclass
class DetailResultMessage:
    job: RawJob | None
    metadata: ScrapeMetadata

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "DETAIL_RESULT",
            "payload": {
                "job": self.job.to_dict() if self.job else None,
                "metadata": {
                    "duration": self.metadata.duration,
                    "profile_used": self.metadata.profile_used,
                    "pages_scraped": self.metadata.pages_scraped,
                    "proxy_used": self.metadata.proxy_used,
                },
            },
        }


@dataclass
class ProgressMessage:
    current: int
    total: int
    source: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "PROGRESS",
            "payload": {
                "current": self.current,
                "total": self.total,
                "source": self.source,
            },
        }


@dataclass
class PongMessage:
    def to_dict(self) -> dict[str, Any]:
        return {"type": "PONG", "payload": {}}


@dataclass
class ErrorMessage:
    code: ErrorCode
    message: str
    retryable: bool = False
    retry_after: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "ERROR",
            "payload": {
                "code": self.code.value,
                "message": self.message,
                "retryable": self.retryable,
                "retry_after": self.retry_after,
            },
        }


# ─── Serialization ────────────────────────────────────────────────────────────

IncomingMessage = Union[
    ScrapeSearchMessage,
    ScrapeDetailMessage,
    PingMessage,
    ShutdownMessage,
]


def parse_message(data: dict[str, Any]) -> IncomingMessage:
    """Parse an incoming message dict into the appropriate typed dataclass."""
    msg_type = data.get("type", "")
    payload = data.get("payload", {})

    if msg_type == MessageType.SCRAPE_SEARCH:
        return ScrapeSearchMessage(type="SCRAPE_SEARCH", payload=payload)
    elif msg_type == MessageType.SCRAPE_DETAIL:
        return ScrapeDetailMessage(type="SCRAPE_DETAIL", payload=payload)
    elif msg_type == MessageType.PING:
        return PingMessage()
    elif msg_type == MessageType.SHUTDOWN:
        return ShutdownMessage()
    else:
        raise ValueError(f"Unknown message type: {msg_type}")


def _read_exactly(stream: Any, n: int) -> bytes:
    """Read exactly n bytes from a stream.

    stream.read(n) on pipes returns UP TO n bytes, not exactly n.
    This function loops until all bytes are read or EOF.
    """
    buf = bytearray()
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            break
        buf.extend(chunk)
    return bytes(buf)


def read_message(stream: Any = None) -> IncomingMessage | None:
    """Read a length-prefixed JSON message from a binary stream.

    Chrome Native Messaging format:
      - 4 bytes: uint32 little-endian message length
      - N bytes: UTF-8 JSON payload

    Args:
        stream: Binary stream (defaults to sys.stdin.buffer).

    Returns:
        Parsed message or None if EOF.
    """
    if stream is None:
        stream = sys.stdin.buffer

    # Read exactly 4-byte length header
    header = _read_exactly(stream, HEADER_SIZE)
    if not header or len(header) < HEADER_SIZE:
        return None

    length = struct.unpack("<I", header)[0]
    if length > MAX_MESSAGE_SIZE:
        raise ValueError(f"Message too large: {length} bytes (max {MAX_MESSAGE_SIZE})")

    # Read exactly message body
    body = _read_exactly(stream, length)
    if not body or len(body) < length:
        return None

    data = json.loads(body.decode("utf-8"))
    return parse_message(data)


def write_message(message: dict[str, Any], stream: Any = None) -> None:
    """Write a length-prefixed JSON message to a binary stream.

    Args:
        message: Dictionary to serialize.
        stream: Binary stream (defaults to sys.stdout.buffer).
    """
    if stream is None:
        stream = sys.stdout.buffer

    body = json.dumps(message, ensure_ascii=False).encode("utf-8")
    if len(body) > MAX_MESSAGE_SIZE:
        raise ValueError(f"Response too large: {len(body)} bytes (max {MAX_MESSAGE_SIZE})")

    header = struct.pack("<I", len(body))
    stream.write(header)
    stream.write(body)
    stream.flush()


def write_error(
    code: ErrorCode,
    message: str,
    retryable: bool = False,
    retry_after: int | None = None,
    stream: Any = None,
) -> None:
    """Convenience: write an error response."""
    err = ErrorMessage(code=code, message=message, retryable=retryable, retry_after=retry_after)
    write_message(err.to_dict(), stream)
