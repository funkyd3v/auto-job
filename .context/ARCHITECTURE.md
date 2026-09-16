# Architecture Reference

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     BACKEND SERVER                               │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────────────────────┐   │
│  │ BullMQ Scheduler │    │ Scraper Service                    │   │
│  │ Cron per source  │───►│                                    │   │
│  └──────────────────┘    │  1. Spawn python3 subprocess       │   │
│                          │  2. scripts/scrape.py              │   │
│  ┌──────────────────┐    │  3. Receive JSON via stdout        │   │
│  │ Fastify API      │    │  4. Normalize                      │   │
│  │ + Dashboard      │    │  5. Match against skills            │   │
│  └──────────────────┘    │  6. Submit to ingestion pipeline    │   │
│                          └──────────────────────────────────┘   │
│  ┌──────────────────┐                                           │
│  │ PostgreSQL       │                                           │
│  │ Redis            │                                           │
│  └──────────────────┘                                           │
│                                                                  │
│  ┌──────────────────┐     ┌─────────────────────────────────┐   │
│  │ Dashboard (nginx)│     │ Python Scraper (Playwright)       │   │
│  └──────────────────┘     │ - Bdjobs                          │   │
│                           │ - NextJobzBD                      │   │
│                           │ - Human behavior simulation       │   │
│                           │ - Stealth techniques              │   │
│                           └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow — Server-Side Scraping

```
BullMQ Cron Scheduler
       │
       ▼
Scraper Worker processes job
       │
       ▼
ScraperExecutor spawns:
    python3 scripts/scrape.py --source bdjobs --config '{"keywords":["Laravel"]}'
       │
       │ stdout JSON:
       │ {
       │   "jobs": [{title, company, url, description, ...}],
       │   "metadata": {duration, pages_scraped, profile_used}
       │ }
       │
       ▼
ScraperService:
    1. Normalize each job
    2. Fetch skills + match_settings from DB
    3. Calculate match_score for each job
    4. Filter: score >= min_match_percentage
    5. Submit qualifying jobs to ingestion pipeline
    6. Record scrape_run metrics
```

## Core Architectural Principle

**The backend is the single source of truth.**

The backend is responsible for:
- Scheduling scrape runs
- Executing scrapers (via Python subprocess)
- Scraping job boards
- Normalizing jobs
- Matching jobs against user skills
- Deduplication
- Persistence
- Notification decisions
- Notification delivery
- Job lifecycle management

## Source Adapter Architecture

Every job source implements a common contract in Python:

```python
class BaseScraper:
    def build_search_url(self, config: dict, page: int = 1) -> str
    async def scrape(self, config: dict, max_pages: int) -> tuple[list[RawJob], dict]
    async def scrape_detail(self, job: RawJob) -> RawJob | None
```

Processing flow:
```
Cron fires → ScraperExecutor spawns Python → Scrape → Normalize → Match → Deduplicate → Persist → Notify
```

Adding a new source requires:
1. Creating a new Python scraper in `scripts/scrapers/`
2. Adding it to the scraper registry in `scripts/scrape.py`
3. No changes to backend orchestration logic

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/logout` | User logout |
| POST | `/api/auth/refresh` | Refresh access token |
| POST | `/api/auth/mfa/verify` | MFA verification |

### Sources
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sources` | List sources |
| POST | `/api/sources` | Create source |
| PATCH | `/api/sources/:id` | Update source |
| DELETE | `/api/sources/:id` | Delete source |

### Jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/jobs/ingest` | Ingest jobs (batch) |
| GET | `/api/jobs` | List jobs |
| GET | `/api/jobs/:id` | Get job details |
| PATCH | `/api/jobs/:id/status` | Update job status |

### Skills
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills` | List skills |
| POST | `/api/skills` | Create skill |
| PATCH | `/api/skills/:id` | Update skill |
| DELETE | `/api/skills/:id` | Delete skill |

### Matching
| Method | Endpoint | Description |
|--------|----------|-------------|
| PATCH | `/api/settings/match` | Update match settings |
| POST | `/api/jobs/:id/rematch` | Recalculate job match |

### Telegram
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/telegram/connect` | Connect Telegram bot |
| POST | `/api/telegram/verify` | Verify Telegram user |
| DELETE | `/api/telegram/disconnect` | Disconnect Telegram |

### Scrape Runs
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/scrape-runs` | Create scrape run record |
| POST | `/api/scrape-runs/trigger` | Manual scrape trigger |
| GET | `/api/scrape-runs` | List scrape runs |
| GET | `/api/scrape-runs/:id` | Get scrape run details |

### Scraper
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/scraper/status` | Browser health status |

### API Keys
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/api-keys` | Create API key |
| DELETE | `/api/api-keys/:id` | Revoke API key |

### Audit
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/audit-log` | List audit logs |

## Concurrency Protection

Two scheduled runs must not scrape the same source simultaneously. Use Redis distributed lock:

```
scrape-lock:{source_id}
```

Flow: Acquire lock → Run scraper → Submit jobs → Report result → Release lock

If another run is active, skip/queue the duplicate.

## Scheduler Ownership

- Backend is the canonical owner of schedule configuration
- Backend executes the schedule via BullMQ repeatable jobs
- Dashboard → Backend stores config → BullMQ creates repeatable job

## Transactional Outbox Pattern

Prevents notification loss:

```
Database Transaction
 ├── Create/update job
 ├── Create notification record
 └── Create outbox event
        ↓
      COMMIT
        ↓
Outbox Worker
        ↓
BullMQ
        ↓
Telegram
```

The database transaction guarantees job and event are committed together.

## Scrape Run Metrics

Each scrape run records:
- `id`, `source_id`, `started_at`, `finished_at`, `status`
- `pages_attempted`, `pages_successful`
- `jobs_found`, `jobs_new`, `jobs_updated`, `jobs_duplicate`, `jobs_matched`
- `notifications_created`
- `scraper_version`, `config_version`
- `error_code`, `error_message`

## Job Status Pipeline

```
NEW → SAVED → APPLIED → INTERVIEW → OFFER → HIRED
                         ↘ REJECTED
                         ↘ ARCHIVED
```

Each status change is recorded in `job_status_history` table.

## Dashboard Pages

- **Overview**: New matching jobs, total jobs, match distribution, application funnel, scrape runs, source health, notification status
- **Jobs**: Searchable table with filtering, pagination, match score, matched skills, source, company, URL, status, discovered date. Optional Kanban view.
- **Sources**: Enable/disable, schedule, status, last successful run, error rate, versions
- **Skills**: CRUD, weights, required/preferred/excluded, aliases, live match preview
- **Logs**: Scrape history, errors, statistics, duplicate/notification counts
- **Settings**: Telegram, API keys, password, MFA, matching threshold, notification preferences
