import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { NotificationQuerySchema, UpdateNotificationStatusSchema } from './notifications.validators.js';
import { PrismaNotificationRepository, DefaultNotificationPolicy } from './notifications.repository.js';
import { PrismaOutboxRepository } from './notifications.repository.js';
import { NotificationService } from './notifications.service.js';
import { ForbiddenError, NotFoundError, BadRequestError } from '../../shared/errors/index.js';

const REQUIRED_SCOPES_WRITE = ['jobs:write'];

function assertScopes(request: FastifyRequest, required: string[]) {
  const scopes = request.apiKeyScopes;
  if (scopes) {
    const hasScope = required.some((s) => scopes.includes(s));
    if (!hasScope) {
      throw new ForbiddenError(`Missing required scope: ${required.join(', ')}`);
    }
  }
}

export async function notificationsRoutes(fastify: FastifyInstance) {
  const notificationRepo = new PrismaNotificationRepository(fastify.prisma);
  const outboxRepo = new PrismaOutboxRepository(fastify.prisma);
  const policy = new DefaultNotificationPolicy(fastify.prisma);
  const service = new NotificationService({ prisma: fastify.prisma, notificationRepo, outboxRepo, policy });

  fastify.addHook('preHandler', fastify.authenticateAny);

  // GET /api/notifications
  fastify.get('/notifications', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.userId!;
    const query = NotificationQuerySchema.parse(request.query);

    const where: Record<string, unknown> = { job: { userId } };
    if (query.channel) where.channel = query.channel;
    if (query.type) where.notificationType = query.type;
    if (query.status) where.status = query.status;

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      fastify.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { job: true },
      }),
      fastify.prisma.notification.count({ where }),
    ]);

    return reply.send({
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  });

  // PATCH /api/notifications/:id/status
  fastify.patch('/notifications/:id/status', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = request.userId!;
    const { id } = request.params;
    const body = UpdateNotificationStatusSchema.parse(request.body);

    const notification = await fastify.prisma.notification.findFirst({
      where: { id, job: { userId } },
    });
    if (!notification) throw new NotFoundError('Notification');

    const updates: Record<string, unknown> = { status: body.status };
    if (body.status === 'SENT') {
      updates.sentAt = new Date();
    }

    const updated = await fastify.prisma.notification.update({
      where: { id },
      data: updates,
    });

    return reply.send({ data: updated });
  });

  // POST /api/notifications/:id/retry
  fastify.post('/notifications/:id/retry', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const userId = request.userId!;
    const { id } = request.params;

    const notification = await fastify.prisma.notification.findFirst({
      where: { id, job: { userId } },
      include: { job: true },
    });
    if (!notification) throw new NotFoundError('Notification');

    if (notification.status !== 'FAILED') {
      return reply.status(400).send({
        error: 'Invalid state',
        message: 'Only failed notifications can be retried',
      });
    }

    // Reset status to PENDING for retry
    const reset = await fastify.prisma.notification.update({
      where: { id },
      data: {
        status: 'PENDING',
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    // Create new outbox event for retry
    await fastify.prisma.outboxEvent.create({
      data: {
        eventType: 'notification_retry',
        payload: {
          notificationId: id,
          retry: true,
        },
      },
    });

    return reply.send({ data: reset });
  });
}
