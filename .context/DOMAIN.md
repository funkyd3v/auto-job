# Domain Model & Business Rules

## Core Entities

### User
Single system user (owner). All data belongs to this user.

### Source
A job board or listing site the system scrapes. Each source has:
- `source_type`: Identifier for the adapter (e.g., `linkedin`, `indeed`, `custom_board`)
- `scraper_config`: JSON configuration for the scraper (selectors, URLs, etc.)
- `config_version`: Version of the configuration
- `scraper_version`: Version of the scraper code in the extension
- `is_enabled`: Whether the source is active
- `schedule`: Cron-like schedule expression

### Job
A discovered job listing. Key properties:
- `external_job_id`: Stable ID from the source (if available)
- `job_fingerprint`: Deterministic hash for deduplication when external ID is unavailable
- `title`, `company`, `location`, `url`, `description`
- `match_score`: Calculated match percentage (0-100)
- `matching_version`: Which algorithm version produced the score
- `status`: Current pipeline status

### Skill
A user-defined skill for matching. Has:
- `skill_name`: Display name
- `normalized_name`: Lowercased, trimmed version for matching
- `weight`: Relative importance (higher = more important)
- `skill_type`: One of `required`, `preferred`, `excluded`

### Skill Alias
Alternative names for a skill (e.g., "PostgreSQL" → aliases: "postgres", "psql").

### Match Settings
User's matching configuration:
- `min_match_percentage`: Threshold for notification eligibility (0-100)
- `notify_on_match`: Whether to send Telegram notifications

### Notification
Record of a sent notification. Has:
- `job_id`: The job that triggered it
- `channel`: Delivery channel (e.g., `telegram`)
- `notification_type`: Type of notification (e.g., `new_match`)
- `status`: Delivery status

### Scrape Run
Record of a scraping execution:
- `source_id`: Which source was scraped
- `started_at`, `finished_at`: Timing
- `status`: Success/failure
- Metrics: jobs found, new, updated, duplicate, matched, notifications created

## Deduplication Rules

### Primary Key — External Job ID
When the source provides a stable external ID:
```
(source_id, external_job_id) must be unique
```
Example: LinkedIn + 123456789

### Fallback — Job Fingerprint
When no stable external ID exists, generate from:
```
fingerprint = hash(
  source_type + "|" +
  canonical_url + "|" +
  normalized_title + "|" +
  normalized_company
)
```
Database enforces uniqueness on `job_fingerprint`.

### URL Canonicalization
Strip tracking parameters before fingerprint generation:
```
/job/123
/job/123?utm_source=email
/job/123?tracking_id=xyz
```
All resolve to: `/job/123`

### Idempotency
Extension sends `Idempotency-Key` header with ingestion requests. Backend recognizes retries and avoids duplicate processing.

### Update Existing Job
If a job already exists (matched by external ID or fingerprint):
1. Compare incoming information
2. Update changed fields
3. Recalculate match if required
4. Do NOT create a second record

## Matching Engine

### Ownership (Phase 7+)

**Matching runs in the Chrome extension**, not the backend. The extension fetches skills and match settings from the backend via API, matches jobs locally, and sends only qualifying jobs to the backend. This avoids storing all scraped jobs — only matching jobs are persisted.

```
Extension fetches skills + settings
         ↓
Extension scrapes jobs
         ↓
Extension matches locally (same formula as below)
         ↓
Only jobs with score >= threshold sent to backend
         ↓
Backend stores pre-matched jobs (no recalculation)
```

### Formula
```
match_score = (sum of weights of matched skills / sum of weights of all scoring skills) × 100
```

Result: 0–100%

### Skill Types

| Type | Behavior |
|------|----------|
| `required` | Job MUST contain these. If missing, job is disqualified (score = 0 or heavy penalty). |
| `preferred` | Contributes positively to match score. |
| `excluded` | Jobs containing these are rejected or heavily penalized. |

### Weight
Relative importance of a skill. Example:
```
Laravel → 40
PHP     → 30
MySQL   → 20
Docker  → 10
Total   → 100
```

If job contains Laravel + PHP + Docker:
```
(40 + 30 + 10) / 100 × 100 = 80%
```

Weights do not need to sum to 100 (normalization handles this).

### Title Weighting
A skill in the job title has greater relevance than in the description. Title match contribution > Description-only contribution. Configurable.

### Matching Version
Each score is associated with a `matching_version` (e.g., `v1`). If algorithm changes, existing jobs can be recalculated without ambiguity.

### Terminology
Call this value **"Match Score"**, not "Confidence". A score of 85% means the configured rules produced an 85% match, not an 85% probability of suitability.

## Notification System

### Notification Deduplication (Mandatory)
Database-level constraint:
```
UNIQUE(job_id, channel, notification_type)
```

Scenario:
- Monday: Job #1001 scraped → Notification sent
- Tuesday: Job #1001 scraped again → NO new notification
- Wednesday: Job #1001 scraped again → NO new notification

### Notification Eligibility
A job qualifies for notification when:
1. `match_score >= min_match_percentage`
2. No existing notification record for this `(job_id, channel, notification_type)`

### Notification Flow
```
Match Score Calculated
    ↓
Meets Threshold?
    ↓ Yes
Already Notified?
    ↓ No
Create Notification Record
    ↓
Create Outbox Event
    ↓
BullMQ picks up
    ↓
Telegram Adapter sends
    ↓
Update notification status
```

### Retry Handling
If Telegram delivery fails:
- Notification remains in pending/failed state
- BullMQ retries according to configured backoff
- Eventually succeeds or exhausted after max retries

## Job Pipeline Statuses

| Status | Description |
|--------|-------------|
| `NEW` | Just discovered |
| `SAVED` | User saved/bookmarked |
| `APPLIED` | User applied |
| `INTERVIEW` | Interview scheduled |
| `OFFER` | Offer received |
| `HIRED` | Hired |
| `REJECTED` | Rejected (by user or employer) |
| `ARCHIVED` | No longer relevant |

Status changes are recorded in `job_status_history` with `from_status`, `to_status`, `note`, and `changed_at`.

## Scrape Run Rules

- Concurrent runs for same source are prevented via Redis lock
- Failure in one source does not stop other sources
- Each run records detailed metrics
- Scrape run configuration (schedule) is owned by backend

## Security Rules

- Passwords hashed with bcrypt
- JWT access tokens (short-lived) + rotating refresh tokens
- Extension uses scoped API keys (not user passwords)
- Sensitive credentials (Telegram bot token) encrypted at rest with AES-256-GCM
- All API payloads validated with Zod
- Scraped job data is untrusted third-party input — sanitize, escape, prevent stored XSS
- HTTPS only, TLS 1.2+
- Rate limiting on all endpoints
- Audit logging for sensitive operations

## Source Compliance

- Use conservative request behavior
- Do NOT circumvent CAPTCHA, authentication controls, anti-bot mechanisms
- If source blocks automation, record as unavailable — do not attempt to defeat protection
- Respect site terms and policies
