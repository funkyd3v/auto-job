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
│   │   │   │   ├── scraper/        # Server-side scraper integration
│   │   │   │   └── audit/          # Audit logging
│   │   │   ├── shared/
│   │   │   │   ├── errors/         # Custom error classes
│   │   │   │   ├── middleware/      # Fastify plugins
│   │   │   │   ├── validators/     # Zod schemas
│   │   │   │   └── utils/          # Helper functions
│   │   │   ├── config/             # Environment config
│   │   │   └── index.ts            # Entry point
│   │   ├── scripts/
│   │   │   ├── scrape.py           # Python scraper entrypoint
│   │   │   ├── requirements.txt    # Python dependencies
│   │   │   ├── scrapers/           # Source-specific scrapers
│   │   │   │   ├── bdjobs.py
│   │   │   │   └── nextjobzbd.py
│   │   │   ├── parser/             # HTML parsers
│   │   │   │   ├── base.py
│   │   │   │   ├── bdjobs.py
│   │   │   │   └── nextjobzbd.py
│   │   │   └── stealth/            # Anti-detection modules
│   │   │       └── human.py        # Human behavior simulation
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── package.json
│   │   └── tsconfig.json
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
│
├── docker-compose.yml
├── docker-compose.dev.yml
├── Dockerfile
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

## Scraper Patterns

### Python Scraper Structure
```python
# scripts/scrapers/bdjobs.py
class BdjobsScraper:
    def __init__(self) -> None:
        self.parser = BdjobsParser()

    @property
    def source_type(self) -> str:
        return "bdjobs"

    def build_search_url(self, config: dict, page: int = 1) -> str:
        # Build search URL from config
        ...

    async def scrape(self, config: dict, max_pages: int = 3) -> tuple[list[RawJob], dict]:
        # Scrape search results with Playwright
        ...

    async def scrape_detail(self, job: RawJob) -> RawJob | None:
        # Scrape detail page for full description
        ...
```

### Subprocess Execution
```typescript
// ScraperExecutor spawns Python subprocess
const executor = new ScraperExecutor();
const result = await executor.execute({
  source_type: 'bdjobs',
  keywords: ['Laravel'],
  max_pages: 3,
});
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
  await page.fill('[data-testid="source-name"]', 'Bdjobs');
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

### Scraper
- Process sources sequentially to avoid resource contention
- Use browser pool for concurrent scraping
- Cache source configuration in memory
- Set appropriate timeouts on scrapes
