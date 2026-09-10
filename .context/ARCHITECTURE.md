# Architecture Reference

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Chrome Extension (Thin)                    │
│                        Manifest V3                               │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ Service Worker    │  │ Popup / Options  │  │ Config Store  │ │
│  │ - Scheduler       │  │ - Source toggle  │  │ - Backend URL │ │
│  │ - Orchestrator    │  │ - Run now        │  │ - API Key     │ │
│  │ - API Client      │  │ - Status         │  │               │ │
│  │ - Offline Queue   │  │                  │  │               │ │
│  └────────┬─────────┘  └──────────────────┘  └───────────────┘ │
│           │                                                      │
│           │ chrome.runtime.connectNative()                       │
│           │ stdin/stdout (length-prefixed JSON)                  │
└───────────┼──────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Native Host (Python)                          │
│  packages/native-host/                                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Stealth HTTP Engine                                     │    │
│  │  - curl_cffi TLS fingerprint impersonation              │    │
│  │  - Browser profile rotation (Chrome/Safari/Firefox)     │    │
│  │  - Realistic header ordering per profile                │    │
│  │  - HTTP/2 + HTTP/3 support                              │    │
│  └──────────────────────┬──────────────────────────────────┘    │
│                         │                                        │
│  ┌──────────────────┐   │  ┌──────────────────────┐            │
│  │ Profile Manager  │   │  │ Timing Engine         │            │
│  │ - 10+ profiles   │───┼──│ - Gaussian delays      │            │
│  │ - Per-session    │   │  │ - Behavioral jitter    │            │
│  │   rotation       │   │  │ - Idle injection       │            │
│  └──────────────────┘   │  └──────────────────────┘            │
│                         │                                        │
│  ┌──────────────────┐   │  ┌──────────────────────┐            │
│  │ Cookie Jar       │   │  │ Proxy Pool           │            │
│  │ - Persistent     │───┼──│ - Rotating residential│            │
│  │ - Domain-scoped  │   │  │ - Health monitoring   │            │
│  └──────────────────┘   │  └──────────────────────┘            │
│                         │                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Parser Engine (BeautifulSoup + lxml)                    │    │
│  │  - LinkedIn search + detail pages                        │    │
│  │  - Indeed card extraction                                │    │
│  │  - Structured JSON output                                │    │
│  └─────────────────────────────────────────────────────────┘    │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │    LinkedIn /     │
              │    Indeed         │
              │  (sees normal     │
              │   desktop app)    │
              └──────────────────┘
```

```
┌───────────────────────────────┐
│ React Dashboard + Vite        │
│                               │
│ Jobs / Sources / Skills       │
│ Settings / Logs / Overview    │
└───────────────┬───────────────┘
                │
                │ HTTPS REST API
                ▼
             Fastify API
```

### Data Flow — Stealth Scraping

```
Extension Scheduler
       │
       ▼
NativeHost.scrapeSearch(url)
       │
       ├─ Select browser profile (random)
       ├─ Build realistic headers
       ├─ Add Gaussian delay
       ├─ HTTP request via curl_cffi (TLS impersonation)
       ├─ Parse HTML → RawSourceJob[]
       └─ Return JSON to extension
       │
       ▼
Extension matches locally
       │
       ▼
Submit qualifying jobs to Backend API
       │
       ▼
Backend dedup + persist + notify
```

## Core Architectural Principle

**The backend is the single source of truth.**

The Chrome extension is an execution client responsible for:
- Scheduling
- Opening source pages
- Extracting jobs
- **Matching jobs against user skills (local)**
- Submitting only qualifying jobs
- Reporting scrape results

The backend is responsible for:
- Validation
- Deduplication
- Persistence
- Notification decisions
- Notification delivery
- Job lifecycle management
- Serving skills and match settings to extension via API

### Matching Ownership (Phase 7+)

**Matching moved to extension** to avoid storing all scraped jobs. Extension fetches skills + settings from backend, matches locally, and sends only jobs meeting the threshold. Backend stores pre-matched jobs without recalculation.

```
Extension                          Backend
   │                                 │
   ├── GET /api/skills ─────────────►│  (skills + aliases)
   ├── GET /api/settings/match ─────►│  (min_match_percentage)
   │                                 │
   │  [scrape + match locally]       │
   │                                 │
   ├── POST /api/jobs/ingest ───────►│  (only matching jobs with match_score)
   │                                 │  (dedup + persist, no recalc)
```

## Data Flow — Job Processing Pipeline (Phase 7+)

```
       ┌──────────────────────────────────────┐
       │           CHROME EXTENSION           │
       └──────────────────────────────────────┘
                      │
                      ▼
               FETCH SKILLS + SETTINGS ◄──── Backend API
                      │
                      ▼
                    SCRAPE
                      │
                      ▼
                NORMALIZE (local)
                      │
                      ▼
                 MATCH (local)
                      │
                      ▼
            MEETS THRESHOLD? ──No──► Discard
                      │
                     Yes
                      │
                      ▼
              SUBMIT MATCHING JOBS
                      │
       ┌──────────────┴──────────────┐
       │         BACKEND API         │
       └──────────────┬──────────────┘
                      │
                      ▼
              IDEMPOTENT INGESTION
                      │
                      ▼
                DEDUPLICATE
               /            \
          Existing          New
             │                │
             ▼                ▼
         Update Job       Create Job
             │                │
             └───────┬────────┘
                     │
                     ▼
              PERSIST SCORE (from extension)
                     │
                     ▼
            CHECK NOTIFICATION
                     │
                     ▼
            ALREADY NOTIFIED?
                /          \
              Yes           No
               │             │
               ▼             ▼
             Done      CREATE NOTIFICATION
                             │
                             ▼
                        OUTBOX EVENT
                             │
                             ▼
                          BullMQ
                             │
                             ▼
                         Telegram
```

## Notification Flow

```
Job Created
    ↓
Match Score Calculated
    ↓
Meets Threshold?
    ↓
Notification Required?
    ↓
Create Notification Record
    ↓
Outbox Event
    ↓
BullMQ
    ↓
Telegram
```

## Source Adapter Architecture

Every job source implements a common contract:

```typescript
interface JobSourceAdapter {
  canHandle(source: Source): boolean;
  validateConfig(config: unknown): void;
  scrape(context: ScrapeContext): Promise<RawSourceJob[]>;
  normalize(job: RawSourceJob): NormalizedJob;
  healthCheck(): Promise<SourceHealth>;
}
```

Processing flow:
```
Raw Web Page → Source Adapter → Raw Source Job → Normalization → Normalized Job → Deduplication → Matching → Persistence → Notification Decision
```

Adding a new source should not modify central orchestration logic.

## Extension Technical Flow

1. Service worker loads configuration
2. **Extension fetches skills + match settings from backend**
3. Backend returns enabled sources and schedules
4. `chrome.alarms` manages scheduled execution
5. Extension starts a scrape run
6. Sources are processed sequentially
7. **Extension sends scrape request to native host via stdin/stdout**
8. **Native host performs stealth HTTP request with TLS impersonation**
9. **Native host parses HTML and returns structured JSON**
10. Jobs are normalized
11. **Extension matches jobs against skills locally**
12. **Only jobs meeting threshold are submitted**
13. Backend performs deduplication and persistence (no recalculation)
14. Backend creates notification events when required
15. Extension reports scrape statistics
16. Failures are isolated to the affected source

## Extension Permissions

Use minimum permissions required:
- `tabs`, `storage`, `alarms`, `nativeMessaging`
- Host permissions limited to configured source domains
- **NEVER** use `<all_urls>` unless absolutely required
- Extension does NOT execute remote JavaScript from backend
- **Native host handles all HTTP scraping** — extension never makes direct requests to job boards

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
| GET | `/api/scrape-runs` | List scrape runs |
| GET | `/api/scrape-runs/:id` | Get scrape run details |

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
- Extension executes the schedule
- Dashboard → Backend stores config → Extension syncs → `chrome.alarms` creates local alarm

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
- `extension_version`, `scraper_version`, `config_version`
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
