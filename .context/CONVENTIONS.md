# Code Conventions & Patterns

## Project Structure

```
auto-job/
├── .context/                        # AI context docs
├── packages/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/           # Authentication, JWT, API keys
│   │   │   │   ├── sources/        # Source management
│   │   │   │   ├── jobs/           # Job ingestion, dedup, status
│   │   │   │   ├── skills/         # Skills CRUD
│   │   │   │   ├── matching/       # Matching engine
│   │   │   │   ├── notifications/  # Notification policy, outbox
│   │   │   │   ├── telegram/       # Telegram adapter
│   │   │   │   ├── scrape-runs/    # Scrape run tracking
│   │   │   │   └── audit/          # Audit logging
│   │   │   ├── shared/
│   │   │   │   ├── errors/         # Custom error classes
│   │   │   │   ├── middleware/      # Fastify plugins
│   │   │   │   ├── validators/     # Zod schemas
│   │   │   │   └── utils/          # Helper functions
│   │   │   ├── config/             # Environment config
│   │   │   └── index.ts            # Entry point
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── native-host/                # Python stealth scraper
│   │   ├── src/auto_job_host/
│   │   │   ├── __init__.py
│   │   │   ├── main.py             # Entry point, message loop
│   │   │   ├── protocol.py         # Message types, serialization
│   │   │   ├── config.py           # Configuration
│   │   │   ├── scrapers/           # Source-specific parsers
│   │   │   │   ├── base.py
│   │   │   │   ├── linkedin.py
│   │   │   │   └── indeed.py
│   │   │   ├── stealth/            # Anti-detection modules
│   │   │   │   ├── tls.py          # curl_cffi TLS impersonation
│   │   │   │   ├── profiles.py     # Browser fingerprint profiles
│   │   │   │   ├── timing.py       # Human-like delays
│   │   │   │   ├── jitter.py       # Request jitter
│   │   │   │   └── headers.py      # Realistic header ordering
│   │   │   ├── network/            # HTTP client + proxy
│   │   │   │   ├── client.py
│   │   │   │   ├── proxy.py
│   │   │   │   └── cookies.py
│   │   │   └── parser/             # HTML parsers
│   │   │       ├── linkedin.py
│   │   │       └── indeed.py
│   │   ├── profiles/               # Browser fingerprint JSONs
│   │   ├── pyproject.toml
│   │   ├── install.sh              # Manifest installer
│   │   └── README.md
│   │
│   ├── dashboard/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── hooks/
│   │   │   ├── stores/             # Zustand stores
│   │   │   ├── lib/                # Utilities
│   │   │   ├── api/                # API client
│   │   │   └── App.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── extension/
│       ├── src/
│       │   ├── service-worker/
│       │   │   ├── scheduler.ts    # chrome.alarms
│       │   │   ├── orchestrator.ts # Scrape orchestration
│       │   │   ├── api-client.ts   # Backend communication
│       │   │   ├── native-host.ts  # Native host connection
│       │   │   └── native-bridge.ts # Type-safe native API
│       │   ├── scrapers/
│       │   │   ├── base.ts         # Adapter interface
│       │   │   ├── linkedin.ts     # Thin wrapper via native host
│       │   │   └── indeed.ts       # Thin wrapper via native host
│       │   ├── content/            # Content scripts
│       │   ├── popup/              # React popup
│       │   ├── options/            # React options page
│       │   └── utils/
│       ├── public/
│       ├── manifest.json
│       ├── package.json
│       └── vite.config.ts
│
├── docker-compose.yml
├── .github/workflows/
├── AGENTS.md                        # AI entry point
└── .context/                        # Context documents
```

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `job-ingestion.ts` |
| Directories | kebab-case | `scrape-runs/` |
| Classes/Types | PascalCase | `JobIngestionService` |
| Functions | camelCase | `calculateMatchScore()` |
| Variables | camelCase | `matchScore` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_ATTEMPTS` |
| Database columns | snake_case | `job_fingerprint` |
| API endpoints | kebab-case | `/api/scrape-runs` |
| Environment vars | UPPER_SNAKE_CASE | `DATABASE_URL` |

## Backend Patterns

### Module Structure
Each module follows this pattern:

```
modules/jobs/
├── jobs.controller.ts      # Route handlers
├── jobs.service.ts         # Business logic
├── jobs.repository.ts      # Database access
├── jobs.validators.ts      # Zod schemas
├── jobs.types.ts           # TypeScript types
└── jobs.test.ts            # Tests
```

### Service Layer Pattern
```typescript
// Business logic depends on abstractions, not concrete implementations
interface JobRepository {
  findByFingerprint(fingerprint: string): Promise<Job | null>;
  create(data: CreateJobInput): Promise<Job>;
  update(id: string, data: UpdateJobInput): Promise<Job>;
}

class JobIngestionService {
  constructor(
    private readonly jobRepo: JobRepository,
    private readonly matcher: MatchingEngine,
    private readonly notifier: NotificationService,
  ) {}

  async ingest(jobs: NormalizedJob[]): Promise<IngestResult> {
    // Business logic here
  }
}
```

### Zod Validation
All API inputs validated with Zod:

```typescript
const IngestJobsSchema = z.object({
  jobs: z.array(z.object({
    external_job_id: z.string().optional(),
    title: z.string().min(1).max(500),
    company: z.string().min(1).max(200),
    url: z.string().url(),
    description: z.string().min(1),
    // ...
  })).min(1).max(100),
  source_id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
});
```

### Error Handling
Custom error classes with HTTP status codes:

```typescript
class DuplicateJobError extends AppError {
  constructor(jobId: string) {
    super({
      code: 'DUPLICATE_JOB',
      message: `Job already exists: ${jobId}`,
      statusCode: 409,
    });
  }
}
```

### Fastify Plugins
Security and shared functionality as Fastify plugins:

```typescript
// Authentication plugin
fastify.register(authPlugin);

// Rate limiting plugin
fastify.register(rateLimitPlugin, { max: 100, window: '1min' });

// CORS plugin
fastify.register(corsPlugin, { origin: allowedOrigins });
```

## Dashboard Patterns

### Component Structure
```typescript
// Functional components with TypeScript
interface JobCardProps {
  job: Job;
  onStatusChange: (id: string, status: JobStatus) => void;
}

export function JobCard({ job, onStatusChange }: JobCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{job.title}</CardTitle>
      </CardHeader>
      {/* ... */}
    </Card>
  );
}
```

### Zustand Store Pattern
```typescript
interface JobsStore {
  jobs: Job[];
  isLoading: boolean;
  error: string | null;
  fetchJobs: () => Promise<void>;
  updateJobStatus: (id: string, status: JobStatus) => Promise<void>;
}

export const useJobsStore = create<JobsStore>((set, get) => ({
  jobs: [],
  isLoading: false,
  error: null,
  fetchJobs: async () => {
    set({ isLoading: true });
    try {
      const jobs = await api.getJobs();
      set({ jobs, isLoading: false });
    } catch (error) {
      set({ error: error.message, isLoading: false });
    }
  },
  // ...
}));
```

### API Client
```typescript
class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  async getJobs(): Promise<Job[]> {
    const response = await fetch(`${this.baseUrl}/api/jobs`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new ApiError(response);
    return response.json();
  }
}
```

## Extension Patterns

### Source Adapter
```typescript
// Base adapter interface — thin wrapper, delegates to native host
interface SourceAdapter {
  canHandle(source: Source): boolean;
  validateConfig(config: unknown): void;
  scrape(context: ScrapeContext): Promise<RawSourceJob[]>;
  normalize(job: RawSourceJob): RawSourceJob;
  healthCheck(): Promise<SourceHealth>;
}

// Concrete adapter — sends request to native host via bridge
class LinkedInAdapter implements SourceAdapter {
  canHandle(source: Source): boolean {
    return source.source_type === 'linkedin';
  }
  
  async scrape(context: ScrapeContext): Promise<RawSourceJob[]> {
    // Delegate to native host — no content script injection
    return nativeBridge.scrapeSearch('linkedin', context.source);
  }
}
```

### Native Host Bridge (TypeScript)
```typescript
// Type-safe wrapper over chrome.runtime.connectNative()
class NativeBridge {
  private port: chrome.runtime.Port | null = null;
  
  connect(): void {
    this.port = chrome.runtime.connectNative('com.autojob.scraper');
  }
  
  async scrapeSearch(source: string, url: string): Promise<RawSourceJob[]> {
    const response = await this.send<SearchResultMessage>({
      type: 'SCRAPE_SEARCH',
      payload: { source, url, config: {} }
    });
    return response.payload.jobs;
  }
  
  private send<T>(message: NativeMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      this.port!.postMessage(message);
      this.port!.onMessage.addListener(function handler(response) {
        if (response.type === 'ERROR') reject(new Error(response.payload.message));
        else resolve(response as T);
        this.port!.onMessage.removeListener(handler);
      });
    });
  }
}
```

### Service Worker Pattern
```typescript
// Alarm-based scheduling
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('scrape-')) {
    const sourceId = alarm.name.replace('scrape-', '');
    await orchestrator.runScrape(sourceId);
  }
});

// Native host lifecycle management
chrome.runtime.onInstalled.addListener(() => {
  nativeHostManager.ensureConnected();
});
```

### Matching Module (Extension)
```typescript
// extension/src/matching/
// Matching runs in extension to avoid storing all scraped jobs.
// Mirrors backend matching.engine.ts formula exactly.
// Version tracked via MATCHING_VERSION constant.

interface MatchingEngine {
  calculate(job: MatchInput, skills: NormalizedSkillForMatch[]): MatchResult;
}

// Orchestrator calls matching before submission:
const matched = matchingEngine.calculate({ title, description }, skills);
if (matched.score >= settings.min_match_percentage) {
  await apiClient.submitJobs(sourceId, [jobWithMatchData]);
}
```

### Native Host Message Protocol
```typescript
// Length-prefixed JSON over stdin/stdout
// Extension → Native Host:
interface ScrapeSearchMessage {
  type: 'SCRAPE_SEARCH';
  payload: {
    source: string;
    url: string;
    config: { proxy?: ProxyConfig; maxPages?: number };
  };
}

// Native Host → Extension:
interface SearchResultMessage {
  type: 'SEARCH_RESULT';
  payload: {
    jobs: RawSourceJob[];
    metadata: { duration: number; profileUsed: string };
  };
}

// Error response:
interface ErrorMessage {
  type: 'ERROR';
  payload: {
    code: 'BLOCKED' | 'RATE_LIMITED' | 'PARSE_ERROR' | 'NETWORK_ERROR';
    message: string;
    retryable: boolean;
  };
}
```

## Testing

### Unit Tests (Vitest)
```typescript
describe('MatchingEngine', () => {
  it('should calculate correct match score', () => {
    const skills = [
      { name: 'Laravel', weight: 40, type: 'required' },
      { name: 'PHP', weight: 30, type: 'preferred' },
    ];
    const job = { title: 'Laravel Developer', description: 'PHP, MySQL' };
    
    const score = calculateMatchScore(skills, job);
    expect(score).toBe(70); // (40+30)/100 * 100
  });

  it('should return 0 for missing required skill', () => {
    // ...
  });
});
```

### Integration Tests
Test the complete ingestion pipeline:
1. Submit job → Normalize → Deduplicate → Match → Persist → Notification
2. Submit duplicate → Verify no new record, no new notification
3. Submit with same Idempotency-Key → Verify idempotent handling

### E2E Tests (Playwright)
```typescript
test('user can configure sources', async ({ page }) => {
  await page.goto('/sources');
  await page.click('[data-testid="add-source"]');
  await page.fill('[data-testid="source-name"]', 'LinkedIn');
  // ...
});
```

### Test File Convention
- Unit tests: `*.test.ts` co-located with source
- Integration tests: `*.integration.test.ts` in `__tests__/`
- E2E tests: `*.spec.ts` in `tests/`

## Security Conventions

### Authentication
- bcrypt for password hashing (cost factor 12)
- JWT access tokens: 15-minute expiry
- Refresh tokens: 7-day expiry, rotating
- httpOnly, secure, SameSite=strict cookies

### API Key Handling
- Keys hashed with SHA-256 before storage
- Only show full key once at creation
- Prefix stored for identification
- Scopes enforced at middleware level

### Input Validation
- All inputs validated with Zod
- Scraped data treated as untrusted
- HTML sanitized before storage
- SQL injection prevented by Prisma
- XSS prevented by React escaping + sanitization

### Secrets Management
- Environment variables for all secrets
- Never commit `.env` files
- Telegram bot token encrypted at rest
- Database not publicly exposed
- Redis not publicly exposed

### Rate Limiting
```typescript
// Apply to all endpoints
fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

// Stricter for auth endpoints
fastify.register(rateLimit, {
  max: 5,
  timeWindow: '15 minutes',
  keyGenerator: (req) => req.ip,
});
```

### Audit Logging
Log all sensitive operations:
- Login/logout
- API key creation/revocation
- Source changes
- Skill changes
- Settings changes
- Job status changes

## Git Conventions

### Commit Messages
Format: `<type>(<scope>): <description>`

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code refactoring
- `test`: Adding tests
- `docs`: Documentation
- `chore`: Maintenance

Examples:
```
feat(jobs): implement fingerprint deduplication
fix(notifications): prevent duplicate telegram messages
refactor(matching): extract scoring to separate module
```

### Branch Naming
- `main` — production
- `develop` — integration
- `feature/<name>` — new features
- `fix/<name>` — bug fixes
- `refactor/<name>` — refactoring

## Performance Guidelines

### Database
- Use Prisma's `select` to fetch only needed fields
- Avoid N+1 queries — use `include` or batch queries
- Add indexes for frequently filtered columns
- Use connection pooling (PgBouncer or Prisma's built-in)

### Backend
- Process jobs in batches, not one-by-one
- Use BullMQ for background processing
- Cache frequently accessed data (skills, settings) in Redis
- Set appropriate timeouts on external calls

### Dashboard
- Implement pagination for all lists
- Use React.lazy for route-based code splitting
- Debounce search/filter inputs
- Use optimistic updates for status changes

### Extension
- Process sources sequentially to avoid resource contention
- Close tabs after scraping
- Cache source configuration locally
- Batch API submissions
