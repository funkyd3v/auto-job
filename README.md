# auto-job

Personal job-hunting automation. Server-side Playwright scrapers pull listings from job boards, a Fastify backend validates, deduplicates and scores them against your skills, and a Telegram bot notifies you of new matches.

## How it works

```
BullMQ cron ──► Python scraper (Playwright) ──► normalize ──► match skills ──► dedupe ──► persist ──► notify (Telegram)
```

- **One logical job = one database record = one notification** (dedup enforced at the database level)
- Backend is the single source of truth: it schedules runs, executes scrapers, matches, persists and notifies
- Idempotent ingestion via `Idempotency-Key`; transactional outbox prevents notification loss
- Scraped data is always sanitized and validated (Zod)

## Project layout

```
packages/backend    Fastify + Prisma + PostgreSQL + Redis + BullMQ + Playwright scrapers
packages/dashboard  React + Vite + Tailwind + shadcn/ui admin dashboard
```

Supported sources: **Bdjobs**, **NextJobzBD**.

## Getting started

Prerequisites: Docker, Node.js, Python 3.

```bash
# 1. Infrastructure (PostgreSQL + Redis)
docker compose -f docker-compose.dev.yml up -d

# 2. Backend
cd packages/backend
cp .env.example .env        # adjust DATABASE_URL, REDIS_URL, JWT_SECRET
npm install
npm run db:push && npm run seed
npm run dev

# 3. Dashboard
cd packages/dashboard
npm install
npm run dev
```

Backend: http://localhost:3000 · Dashboard: http://localhost:5173

## Production deploy (VPS)

```bash
bash deploy.sh
```

Generates `.env` with random secrets, builds images (Docker + compose needed),
starts Postgres/Redis/backend/dashboard, and prints your dashboard URL.
Add a Telegram bot token in `.env` before first run if you want notifications.

## Commands

| Command              | Description                     |
|----------------------|---------------------------------|
| `npm run dev`        | Dev server (hot reload)         |
| `npm run test:run`   | Run Vitest tests                |
| `npm run typecheck`  | TypeScript check                |
| `npm run db:studio`  | Prisma Studio                   |
| `npm run seed`       | Seed skills and admin user      |

## Stack

Node.js · TypeScript · Fastify · Prisma · PostgreSQL · Redis · BullMQ · Playwright · Python · React · Vite · Tailwind CSS · shadcn/ui · grammY · Docker Compose