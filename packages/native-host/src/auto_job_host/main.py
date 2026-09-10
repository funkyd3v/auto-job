"""Chrome Native Messaging host entry point.

Reads length-prefixed JSON from stdin, processes scrape requests
via the stealth HTTP client, and writes responses to stdout.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from pathlib import Path

from . import __version__
from .config import Config
from .protocol import (
    ErrorCode,
    IncomingMessage,
    MessageType,
    PingMessage,
    PongMessage,
    SearchResultMessage,
    DetailResultMessage,
    ErrorMessage,
    ProgressMessage,
    ScrapeDetailMessage,
    ScrapeSearchMessage,
    ShutdownMessage,
    read_message,
    write_message,
)
from .network.client import StealthClient, StealthRequestError
from .network.proxy import ProxyConfig, ProxyPool, parse_proxy_string
from .stealth.profiles import ProfileManager
from .stealth import timing
from .scrapers.linkedin import LinkedInScraper
from .scrapers.indeed import IndeedScraper

logger = logging.getLogger("autojob-host")


def setup_logging(level: str = "INFO") -> None:
    """Configure logging to stderr (stdout is reserved for messages)."""
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="[%(asctime)s] %(name)s %(levelname)s: %(message)s",
        stream=sys.stderr,
        datefmt="%H:%M:%S",
    )


class NativeHost:
    """Main native host application."""

    def __init__(self, config: Config):
        self.config = config
        self.running = False

        # Initialize components
        self.profile_manager = ProfileManager(config.profiles_dir)
        self.proxy_pool = self._init_proxy_pool()
        self.client = StealthClient(
            self.profile_manager,
            self.proxy_pool,
            config.cookie_storage_dir,
        )

        # Initialize scrapers
        self.scrapers = {
            "linkedin": LinkedInScraper(self.client, self.profile_manager),
            "indeed": IndeedScraper(self.client, self.profile_manager),
        }

        logger.info(
            "NativeHost v%s initialized — %d profiles, %d proxies",
            __version__,
            self.profile_manager.count,
            self.proxy_pool.total_count if self.proxy_pool else 0,
        )

    def _init_proxy_pool(self) -> ProxyPool | None:
        """Initialize proxy pool from config."""
        proxy_urls = self.config.get_proxies()
        if not proxy_urls:
            return None

        pool = ProxyPool()
        for url in proxy_urls:
            try:
                proxy = parse_proxy_string(url)
                pool.add(proxy)
            except Exception as e:
                logger.warning("Failed to parse proxy %s: %s", url, e)

        if pool.total_count > 0:
            logger.info("Loaded %d proxies", pool.total_count)
            return pool
        return None

    async def handle_message(self, message: IncomingMessage) -> None:
        """Process an incoming message and send response."""
        if isinstance(message, PingMessage):
            write_message(PongMessage().to_dict())

        elif isinstance(message, ShutdownMessage):
            logger.info("Shutdown requested")
            self.running = False
            write_message({"type": "SHUTDOWN_ACK", "payload": {}})

        elif isinstance(message, ScrapeSearchMessage):
            await self._handle_scrape_search(message)

        elif isinstance(message, ScrapeDetailMessage):
            await self._handle_scrape_detail(message)

        else:
            write_message(
                ErrorMessage(
                    code=ErrorCode.CONFIG_ERROR,
                    message=f"Unknown message type: {message.type}",
                ).to_dict()
            )

    async def _handle_scrape_search(self, message: ScrapeSearchMessage) -> None:
        """Handle a search scrape request."""
        source = message.source
        url = message.url
        config = message.config

        scraper = self.scrapers.get(source)
        if not scraper:
            write_message(
                ErrorMessage(
                    code=ErrorCode.CONFIG_ERROR,
                    message=f"Unknown source: {source}",
                ).to_dict()
            )
            return

        session_id = f"{source}_{int(time.time())}"

        try:
            # Build search URL if not provided directly
            if not url:
                # Parse config for URL construction
                scrape_config = {
                    "keywords": config.get("keywords", []),
                    "location": config.get("location"),
                    "max_age": config.get("max_age", "r86400"),
                }
                url = scraper.build_search_url(scrape_config)

            # Scrape search results
            jobs, metadata = await scraper.scrape_search(
                config=config,
                search_url=url,
                session_id=session_id,
                max_pages=config.max_pages if hasattr(config, "max_pages") else self.config.max_pages_per_search,
            )

            # Optionally scrape detail pages for top jobs
            detail_count = min(len(jobs), 5)  # Limit detail pages
            if detail_count > 0:
                detail_jobs = await scraper.scrape_detail_batch(
                    jobs[:detail_count],
                    config,
                    session_id,
                )
                # Merge detail data back
                for i, detail_job in enumerate(detail_jobs):
                    if detail_job:
                        jobs[i] = detail_job

            response = SearchResultMessage(jobs=jobs, metadata=metadata)
            write_message(response.to_dict())

        except StealthRequestError as e:
            write_message(
                ErrorMessage(
                    code=e.code,
                    message=e.message,
                    retryable=e.retryable,
                    retry_after=e.retry_after,
                ).to_dict()
            )
        except Exception as e:
            logger.exception("Unexpected error during search scrape")
            write_message(
                ErrorMessage(
                    code=ErrorCode.HOST_ERROR,
                    message=f"Internal error: {e}",
                    retryable=True,
                ).to_dict()
            )
        finally:
            self.profile_manager.release_session(session_id)
            if self.proxy_pool:
                self.proxy_pool.release_session(session_id)

    async def _handle_scrape_detail(self, message: ScrapeDetailMessage) -> None:
        """Handle a detail page scrape request."""
        source = message.source
        url = message.url

        scraper = self.scrapers.get(source)
        if not scraper:
            write_message(
                ErrorMessage(
                    code=ErrorCode.CONFIG_ERROR,
                    message=f"Unknown source: {source}",
                ).to_dict()
            )
            return

        session_id = f"{source}_detail_{int(time.time())}"

        try:
            # Create a minimal job for detail scraping
            from .protocol import RawJob
            search_job = RawJob(url=url)

            start_time = time.monotonic()
            detail_job = await scraper.scrape_detail(
                search_job,
                message.config,
                session_id,
            )
            duration = int((time.monotonic() - start_time) * 1000)

            profile = self.profile_manager.get_for_session(session_id)
            metadata = timing.TimingEngine()

            response = DetailResultMessage(
                job=detail_job,
                metadata={
                    "duration": duration,
                    "profile_used": profile.id,
                    "pages_scraped": 1,
                },
            )

            # Build response dict manually since metadata is a dict not ScrapeMetadata
            write_message({
                "type": "DETAIL_RESULT",
                "payload": {
                    "job": detail_job.to_dict() if detail_job else None,
                    "metadata": {
                        "duration": duration,
                        "profile_used": profile.id,
                        "pages_scraped": 1,
                    },
                },
            })

        except StealthRequestError as e:
            write_message(
                ErrorMessage(
                    code=e.code,
                    message=e.message,
                    retryable=e.retryable,
                    retry_after=e.retry_after,
                ).to_dict()
            )
        except Exception as e:
            logger.exception("Unexpected error during detail scrape")
            write_message(
                ErrorMessage(
                    code=ErrorCode.HOST_ERROR,
                    message=f"Internal error: {e}",
                    retryable=True,
                ).to_dict()
            )
        finally:
            self.profile_manager.release_session(session_id)
            if self.proxy_pool:
                self.proxy_pool.release_session(session_id)

    async def run(self) -> None:
        """Main message loop — reads from stdin, writes to stdout."""
        self.running = True
        logger.info("Native host started, waiting for messages...")

        while self.running:
            try:
                message = read_message()
                if message is None:
                    logger.info("stdin closed, shutting down")
                    break

                await self.handle_message(message)

            except EOFError:
                logger.info("EOF received, shutting down")
                break
            except Exception as e:
                logger.exception("Error in message loop")
                try:
                    write_message(
                        ErrorMessage(
                            code=ErrorCode.HOST_ERROR,
                            message=f"Message loop error: {e}",
                        ).to_dict()
                    )
                except Exception:
                    pass

        await self.client.close()
        logger.info("Native host stopped")


def main() -> None:
    """Entry point for the native host."""
    # Load configuration
    config_file = os.environ.get("AUTOJOB_CONFIG")
    if config_file:
        config = Config.from_file(Path(config_file))
    else:
        config = Config.from_env()

    setup_logging(config.log_level)

    # Run the host
    host = NativeHost(config)
    asyncio.run(host.run())


if __name__ == "__main__":
    main()
