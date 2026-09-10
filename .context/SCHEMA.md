# Database Schema Reference

## Tables

### users
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | User identifier |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL | Login email |
| `password_hash` | VARCHAR(255) | NOT NULL | bcrypt hash |
| `mfa_secret_encrypted` | TEXT | NULL | AES-256-GCM encrypted TOTP secret |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Account creation |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last update |

### api_keys
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | API key identifier |
| `user_id` | UUID | FK → users.id | Owner |
| `key_hash` | VARCHAR(255) | NOT NULL | SHA-256 hash of the key |
| `key_prefix` | VARCHAR(8) | NOT NULL | First 8 chars for identification |
| `name` | VARCHAR(100) | NOT NULL | Human-readable name |
| `scopes` | JSONB | NOT NULL | Array of scope strings |
| `extension_id` | VARCHAR(100) | NULL | Browser extension identifier |
| `created_at` | TIMESTAMPTZ | NOT NULL | Creation time |
| `last_used_at` | TIMESTAMPTZ | NULL | Last usage |
| `expires_at` | TIMESTAMPTZ | NULL | Optional expiration |
| `revoked_at` | TIMESTAMPTZ | NULL | Revocation time |

Scopes: `jobs:write`, `sources:read`, `scrape-runs:write`

### sources
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Source identifier |
| `user_id` | UUID | FK → users.id | Owner |
| `name` | VARCHAR(100) | NOT NULL | Display name |
| `source_type` | VARCHAR(50) | NOT NULL | Adapter identifier (linkedin, indeed, custom_board) |
| `base_url` | TEXT | NOT NULL | Source website URL |
| `scraper_config` | JSONB | NOT NULL | Adapter-specific configuration |
| `config_version` | INTEGER | NOT NULL, DEFAULT 1 | Configuration version |
| `scraper_version` | VARCHAR(20) | NOT NULL | Required scraper version |
| `is_enabled` | BOOLEAN | NOT NULL, DEFAULT true | Active state |
| `schedule` | VARCHAR(50) | NOT NULL | Cron expression (e.g., "0 */6 * * *") |
| `created_at` | TIMESTAMPTZ | NOT NULL | Creation time |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last update |

### skills
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Skill identifier |
| `user_id` | UUID | FK → users.id | Owner |
| `skill_name` | VARCHAR(100) | NOT NULL | Display name |
| `weight` | INTEGER | NOT NULL, DEFAULT 1 | Relative importance (1-100) |
| `skill_type` | ENUM | NOT NULL | `required`, `preferred`, `excluded` |
| `normalized_name` | VARCHAR(100) | NOT NULL | Lowercase, trimmed |
| `created_at` | TIMESTAMPTZ | NOT NULL | Creation time |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last update |

### skill_aliases
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Alias identifier |
| `skill_id` | UUID | FK → skills.id | Parent skill |
| `alias` | VARCHAR(100) | NOT NULL | Alternative name |
| `normalized_alias` | VARCHAR(100) | NOT NULL | Lowercase, trimmed |
| `created_at` | TIMESTAMPTZ | NOT NULL | Creation time |

### match_settings
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PK, FK → users.id | Owner (one row per user) |
| `min_match_percentage` | INTEGER | NOT NULL, DEFAULT 70 | Threshold (0-100) |
| `notify_on_match` | BOOLEAN | NOT NULL, DEFAULT true | Enable notifications |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last update |

### jobs
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Job identifier |
| `user_id` | UUID | FK → users.id | Owner |
| `source_id` | UUID | FK → sources.id | Source |
| `external_job_id` | VARCHAR(255) | NULL | Stable ID from source |
| `job_fingerprint` | VARCHAR(64) | UNIQUE | SHA-256 hash for dedup |
| `title` | TEXT | NOT NULL | Job title |
| `company` | TEXT | NOT NULL | Company name |
| `location` | TEXT | NULL | Job location |
| `url` | TEXT | NOT NULL | Job listing URL |
| `description` | TEXT | NOT NULL | Full job description |
| `salary` | TEXT | NULL | Salary info if available |
| `match_score` | INTEGER | NULL | Calculated score (0-100) — set by extension |
| `matching_version` | VARCHAR(20) | NULL | Algorithm version (e.g., "ext-v1") — set by extension |
| `matched_skills` | JSONB | NULL | Skills that matched: `[{skill_id, skill_name, type, weight, matched, matched_in_title, contribution}]` |
| `status` | ENUM | NOT NULL, DEFAULT 'NEW' | Pipeline status |
| `scraped_at` | TIMESTAMPTZ | NOT NULL | When discovered |
| `created_at` | TIMESTAMPTZ | NOT NULL | Record creation |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last update |

**Indexes:**
- `UNIQUE(source_id, external_job_id)` — when external_job_id is not null
- `UNIQUE(job_fingerprint)` — for fingerprint dedup
- `(user_id, status)` — filtering
- `(user_id, match_score)` — sorting/filtering
- `(source_id)` — source-based queries

### job_status_history
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Record identifier |
| `job_id` | UUID | FK → jobs.id | Job |
| `from_status` | ENUM | NOT NULL | Previous status |
| `to_status` | ENUM | NOT NULL | New status |
| `note` | TEXT | NULL | Optional note |
| `changed_at` | TIMESTAMPTZ | NOT NULL | When changed |

### notifications
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Notification identifier |
| `job_id` | UUID | FK → jobs.id | Triggering job |
| `channel` | VARCHAR(50) | NOT NULL | Delivery channel (telegram) |
| `notification_type` | VARCHAR(50) | NOT NULL | Type (new_match) |
| `status` | ENUM | NOT NULL, DEFAULT 'PENDING' | PENDING, SENT, FAILED |
| `attempts` | INTEGER | NOT NULL, DEFAULT 0 | Delivery attempts |
| `sent_at` | TIMESTAMPTZ | NULL | When sent |
| `provider_message_id` | VARCHAR(100) | NULL | Telegram message ID |
| `last_error` | TEXT | NULL | Last failure reason |
| `created_at` | TIMESTAMPTZ | NOT NULL | Creation time |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last update |

**Constraint:** `UNIQUE(job_id, channel, notification_type)` — prevents duplicate notifications

### outbox_events
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Event identifier |
| `event_type` | VARCHAR(50) | NOT NULL | Event type (notification_created) |
| `payload` | JSONB | NOT NULL | Event data |
| `status` | ENUM | NOT NULL, DEFAULT 'PENDING' | PENDING, PROCESSED, FAILED |
| `created_at` | TIMESTAMPTZ | NOT NULL | Creation time |
| `processed_at` | TIMESTAMPTZ | NULL | When processed |

### scrape_runs
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Run identifier |
| `source_id` | UUID | FK → sources.id | Source scraped |
| `started_at` | TIMESTAMPTZ | NOT NULL | Start time |
| `finished_at` | TIMESTAMPTZ | NULL | End time |
| `status` | ENUM | NOT NULL | RUNNING, SUCCESS, FAILED |
| `pages_attempted` | INTEGER | NOT NULL, DEFAULT 0 | Pages visited |
| `pages_successful` | INTEGER | NOT NULL, DEFAULT 0 | Pages OK |
| `jobs_found` | INTEGER | NOT NULL, DEFAULT 0 | Total found |
| `jobs_new` | INTEGER | NOT NULL, DEFAULT 0 | New jobs |
| `jobs_updated` | INTEGER | NOT NULL, DEFAULT 0 | Updated existing |
| `jobs_duplicate` | INTEGER | NOT NULL, DEFAULT 0 | Duplicates skipped |
| `jobs_matched` | INTEGER | NOT NULL, DEFAULT 0 | Above threshold |
| `notifications_created` | INTEGER | NOT NULL, DEFAULT 0 | Notifications queued |
| `extension_version` | VARCHAR(20) | NULL | Extension version |
| `scraper_version` | VARCHAR(20) | NULL | Scraper version |
| `config_version` | INTEGER | NULL | Config version |
| `error_code` | VARCHAR(50) | NULL | Error identifier |
| `error_message` | TEXT | NULL | Error details |
| `created_at` | TIMESTAMPTZ | NOT NULL | Record creation |

### audit_logs
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Log identifier |
| `user_id` | UUID | FK → users.id | Actor |
| `action` | VARCHAR(100) | NOT NULL | Action performed |
| `resource_type` | VARCHAR(50) | NOT NULL | Resource type |
| `resource_id` | UUID | NULL | Resource identifier |
| `details` | JSONB | NULL | Additional context |
| `ip_address` | INET | NULL | Client IP |
| `created_at` | TIMESTAMPTZ | NOT NULL | When occurred |

## Relationships

```
users ──┬── api_keys
        ├── sources ──── scrape_runs
        ├── skills ──── skill_aliases
        ├── match_settings
        ├── jobs ────┬── job_status_history
        │            └── notifications
        └── audit_logs

outbox_events (standalone, processed by worker)
```

## Migration Strategy

- Use Prisma Migrate for schema management
- Never manually edit production database
- All migrations are version-controlled
- Test migrations against copy of production data before applying
