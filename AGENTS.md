# AI Agents — auto-job

> Single entry point for all AI models working on this project.

## Project

**auto-job** — Personal job-hunting automation system. Single-user, unattended.

Server-side Playwright scrapers → Fastify backend validates/deduplicates/matches → Telegram notifies user of new matches.

## Core Business Rule (Non-Negotiable)

```
Same logical job → One database record → One notification
```

- Deduplication enforced at DATABASE level, not only application logic
- Notification deduplication via `UNIQUE(job_id, channel, notification_type)`
- Idempotent ingestion via `Idempotency-Key` header

## Tech Stack (Locked — Do Not Suggest Alternatives)

| Component | Stack |
|-----------|-------|
| Backend | Node.js + TypeScript + Fastify + Prisma + PostgreSQL + Redis + BullMQ |
| Scraper | Python + Playwright + BeautifulSoup + lxml |
| Dashboard | React + Vite + TypeScript + Tailwind CSS + shadcn/ui + Zustand |
| Telegram | grammY |
| Testing | Vitest + Playwright |
| Deploy | Docker Compose + Nginx + Let's Encrypt |

**Explicitly excluded:** Chrome extension, Next.js, MongoDB, multi-user, AI semantic matching.

## Server-Side Scraper Architecture

The backend runs **Playwright-based scrapers** in a Python subprocess. The scrapers handle all HTML parsing and stealth techniques.

```
Backend (Node.js)
    │
    │ spawns subprocess
    ▼
Python Scraper (Playwright)
    │
    │ Navigate to job board
    │ Wait for JS rendering
    │ Extract job listings
    │ Return JSON via stdout
    │
    ▼
Backend receives JSON
    │
    ├── Normalize jobs
    ├── Fetch skills + settings
    ├── Match against skills
    ├── Filter by threshold
    └── Submit to ingestion pipeline
```

## Context Files

Read these in order for full project understanding:

| File | Contains |
|------|----------|
| `.context/ARCHITECTURE.md` | System design, data flow, API endpoints, component relationships |
| `.context/DOMAIN.md` | Business rules, matching engine, deduplication, notifications |
| `.context/SCHEMA.md` | Database schema (10 tables), indexes, relationships |
| `.context/CONVENTIONS.md` | Code patterns, naming, testing, security, Git conventions |

## Key Guarantees

1. Same logical job → One DB record
2. Same job scraped again → Update existing, no duplicate
3. Same qualifying job → One "new match" notification
4. API retry → Idempotent processing
5. Telegram failure → Queue retry
6. Database commit → Job + notification event committed atomically

## Architecture Principle

**The backend is the single source of truth.** The backend schedules scrapes, executes Python scrapers, validates, deduplicates, matches, persists, and notifies.

## Development Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Backend Foundation (Fastify, Prisma, Auth) | Not started |
| 2 | Job Ingestion (normalize, deduplicate, persist) | Not started |
| 3 | Server-Side Scraper (Playwright + Python) | In Progress |
| 4 | Matching Engine | Not started |
| 5 | Telegram Notifications | Not started |
| 6 | Scheduling | Complete |
| 7 | Multi-Source Scraping | Not started |
| 8 | Job Pipeline | Not started |
| 9 | Observability | Not started |
| 10 | Final Security & QA | Not started |

## Rules for AI Agents

1. **Read `.context/` files first** before making any changes
2. **Never suggest alternatives** to locked technology decisions
3. **Always enforce deduplication** at database level
4. **Never skip validation** — all inputs go through Zod
5. **Scraped data is untrusted** — always sanitize
6. **Test critical paths** — deduplication, idempotency, notification dedup
7. **Follow existing patterns** — check `.context/CONVENTIONS.md` before writing code
8. **Security from Phase 1** — never bolt it on later
9. **One logical job = One record** — this is the most important rule
10. **When in doubt, check the context files** — they are the source of truth
