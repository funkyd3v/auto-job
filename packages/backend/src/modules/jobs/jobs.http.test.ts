import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { hashApiKey, generateApiKey } from '../../shared/middleware/auth-utils.js';
import { buildApp } from '../../index.js';

describe('Jobs HTTP — ingest + idempotency', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userId: string;
  let sourceId: string;
  let apiKey: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    // Create user + source via prisma
    const email = `http-${Date.now()}@example.com`;
    const user = await app.prisma.user.create({
      data: { email, passwordHash: 'hash', matchSettings: { create: {} } },
    });
    userId = user.id;

    const source = await app.prisma.source.create({
      data: {
        userId,
        name: 'HTTP Test Source',
        sourceType: 'linkedin',
        baseUrl: 'https://linkedin.com',
        scraperConfig: {},
        scraperVersion: '1.0.0',
        schedule: '0 */6 * * *',
      },
    });
    sourceId = source.id;

    // Create API key with jobs:write scope
    apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);
    await app.prisma.apiKey.create({
      data: {
        userId,
        keyHash,
        keyPrefix: apiKey.substring(0, 8),
        name: 'test-key',
        scopes: ['jobs:write', 'sources:read'],
      },
    });
  });

  afterAll(async () => {
    await app.prisma.job.deleteMany({ where: { userId } }).catch(() => {});
    await app.prisma.idempotencyKey.deleteMany({ where: { userId } }).catch(() => {});
    await app.prisma.apiKey.deleteMany({ where: { userId } }).catch(() => {});
    await app.prisma.source.deleteMany({ where: { userId } }).catch(() => {});
    await app.prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    await app.close();
  });

  it('POST /api/jobs/ingest creates job and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs/ingest',
      headers: { 'x-api-key': apiKey },
      payload: {
        source_id: sourceId,
        jobs: [
          {
            title: 'HTTP Test Engineer',
            company: 'ACME HTTP',
            url: 'https://example.com/job/http-1?utm_source=test',
            description: 'desc http',
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(1);
  });

  it('Idempotency-Key replays same response without duplicate', async () => {
    const idempotencyKey = randomUUID();
    const payload = {
      source_id: sourceId,
      jobs: [
        {
          title: 'Idempotent Job',
          company: 'IdemCo',
          url: 'https://example.com/job/idem-1',
          description: 'idem desc',
        },
      ],
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/jobs/ingest',
      headers: { 'x-api-key': apiKey, 'Idempotency-Key': idempotencyKey },
      payload,
    });
    expect(res1.statusCode).toBe(201);
    const body1 = res1.json();

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/jobs/ingest',
      headers: { 'x-api-key': apiKey, 'Idempotency-Key': idempotencyKey },
      payload,
    });
    // Should be replayed — per implementation returns cached 201 with header
    expect(res2.statusCode).toBe(201);
    expect(res2.headers['x-idempotent-replayed']).toBe('true');
    const body2 = res2.json();
    expect(body2).toEqual(body1);

    // DB should have only one job with that title/company
    const count = await app.prisma.job.count({ where: { userId, title: 'Idempotent Job' } });
    expect(count).toBe(1);
  });

  it('GET /api/jobs lists with pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/jobs',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.total).toBeGreaterThan(0);
  });

  it('PATCH /api/jobs/:id/status transitions', async () => {
    const job = await app.prisma.job.findFirst({ where: { userId } });
    expect(job).not.toBeNull();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/jobs/${job!.id}/status`,
      headers: { 'x-api-key': apiKey },
      payload: { status: 'SAVED', note: 'http test save' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('SAVED');
  });

  it('rejects without authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs/ingest',
      payload: { source_id: sourceId, jobs: [{ title: 'x', company: 'y', url: 'https://example.com', description: 'd' }] },
    });
    expect(res.statusCode).toBe(401);
  });
});
