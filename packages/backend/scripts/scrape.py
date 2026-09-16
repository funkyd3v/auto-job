"""Standalone scraper entry point.

Called from Node.js backend via subprocess.
Outputs JSON to stdout with {jobs: [...], metadata: {...}}.

Usage:
    python3 scripts/scrape.py --source bdjobs --config '{"keywords":["Laravel"]}'
    python3 scripts/scrape.py --source nextjobzbd --config '{"keywords":["Developer"]}'
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from typing import Any

from scrapers.bdjobs import BdjobsScraper
from scrapers.nextjobzbd import NextJobzBdScraper

logger = logging.getLogger("autojob.scrape")

# Total seconds allowed for detail-scraping (all jobs combined).
# Must be less than the executor timeout (300s) minus the search deadline.
DETAIL_DEADLINE_SECONDS = 90

# Per-detail page timeout (seconds).
DETAIL_TIMEOUT_SECONDS = 30


def setup_logging() -> None:
    """Configure logging to stderr (stdout is reserved for JSON output)."""
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(name)s %(levelname)s: %(message)s",
        stream=sys.stderr,
        datefmt="%H:%M:%S",
    )


def get_scraper(source: str):
    """Get scraper instance by source type."""
    scrapers = {
        "bdjobs": BdjobsScraper,
        "nextjobzbd": NextJobzBdScraper,
    }
    scraper_cls = scrapers.get(source)
    if not scraper_cls:
        raise ValueError(f"Unknown source: {source}. Available: {list(scrapers.keys())}")
    return scraper_cls()


async def run_scrape(source: str, config: dict[str, Any], max_pages: int) -> dict[str, Any]:
    """Run the scrape and return structured result."""
    scraper = get_scraper(source)

    keywords = config.get("keywords", [])
    logger.info("Starting %s scrape with %d keyword(s): %s", source, len(keywords), keywords)

    jobs, metadata = await scraper.scrape(
        config=config,
        max_pages=max_pages,
    )

    logger.info("Search complete: %d jobs found, enriching details...", len(jobs))

    # Enrich jobs with detail pages (search cards omit descriptions).
    # Bounded by DETAIL_DEADLINE_SECONDS to prevent the total process from
    # hanging when many jobs are found (each detail page opens a new browser).
    enriched_jobs: list[dict[str, Any]] = []
    detail_start = time.monotonic()
    detail_budget = DETAIL_DEADLINE_SECONDS

    for i, job in enumerate(jobs):
        elapsed = time.monotonic() - detail_start
        remaining = detail_budget - elapsed
        if remaining < 5:
            logger.info(
                "Detail deadline reached after %d jobs (%.0fs elapsed) — skipping %d remaining",
                i,
                elapsed,
                len(jobs) - i,
            )
            enriched_jobs.append(job.to_dict())
            continue

        try:
            enriched = await asyncio.wait_for(
                scraper.scrape_detail(job),
                timeout=min(DETAIL_TIMEOUT_SECONDS, remaining),
            )
            enriched_jobs.append(enriched.to_dict() if enriched else job.to_dict())
        except asyncio.TimeoutError:
            logger.warning("Detail timeout for job %s — using search data", job.external_job_id)
            enriched_jobs.append(job.to_dict())
        except Exception as e:
            logger.warning("Detail scrape failed for %s: %s — using search data", job.external_job_id, e)
            enriched_jobs.append(job.to_dict())

    return {
        "jobs": enriched_jobs,
        "metadata": metadata,
    }


def main() -> None:
    """Parse arguments and run scraper."""
    parser = argparse.ArgumentParser(description="Job board scraper")
    parser.add_argument(
        "--source",
        required=True,
        choices=["bdjobs", "nextjobzbd"],
        help="Job board source to scrape",
    )
    parser.add_argument(
        "--config",
        required=True,
        help="JSON configuration (keywords, location, etc.)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=3,
        help="Maximum pages to scrape (default: 3)",
    )

    args = parser.parse_args()

    # Parse config
    try:
        config = json.loads(args.config)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid config JSON: {e}"}), file=sys.stderr)
        sys.exit(1)

    # Run scraper
    result = asyncio.run(run_scrape(args.source, config, args.max_pages))

    # Output JSON to stdout
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
