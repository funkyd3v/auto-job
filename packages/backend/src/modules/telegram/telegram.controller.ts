import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TelegramConnectSchema } from './telegram.validators.js';
import { TelegramAdapter } from './telegram.adapter.js';
import { PrismaNotificationRepository, PrismaOutboxRepository } from '../notifications/notifications.repository.js';
import { encryptSecret } from './telegram.crypto.js';

export async function telegramRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticateAny);

  // GET /api/telegram/status
  fastify.get('/telegram/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const settings = await fastify.prisma.matchSettings.findUnique({
      where: { userId: request.userId! },
    });

    return reply.send({
      data: {
        connected: Boolean(settings?.telegramConnectedAt && settings?.telegramBotTokenEncrypted),
        botUsername: settings?.telegramBotUsername ?? null,
        chatId: settings?.telegramChatId ?? null,
        notifyOnMatch: settings?.notifyOnMatch ?? false,
        envFallback: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      },
    });
  });

  // POST /api/telegram/connect
  fastify.post('/telegram/connect', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = TelegramConnectSchema.parse(request.body);

    const adapter = new TelegramAdapter({
      botToken: body.botToken,
      chatId: body.chatId,
      notificationRepo: new PrismaNotificationRepository(fastify.prisma),
      outboxRepo: new PrismaOutboxRepository(fastify.prisma),
    });

    const health = await adapter.healthCheck(body.botToken);
    if (!health.isHealthy) {
      throw new Error('Invalid Telegram bot configuration');
    }

    const botUsername = (health.botInfo && health.botInfo.username) || null;

    // Persist credentials (encrypted at rest) so the outbox worker can deliver notifications.
    await fastify.prisma.matchSettings.upsert({
      where: { userId: request.userId! },
      create: {
        userId: request.userId!,
        telegramBotTokenEncrypted: encryptSecret(body.botToken),
        telegramChatId: body.chatId,
        telegramBotUsername: botUsername,
        telegramConnectedAt: new Date(),
        notifyOnMatch: true,
      },
      update: {
        telegramBotTokenEncrypted: encryptSecret(body.botToken),
        telegramChatId: body.chatId,
        telegramBotUsername: botUsername,
        telegramConnectedAt: new Date(),
        notifyOnMatch: true,
      },
    });

    return reply.send({
      success: true,
      message: 'Telegram bot connected successfully',
      data: {
        botUsername,
        chatId: body.chatId,
      },
    });
  });

  // POST /api/telegram/verify
  fastify.post('/telegram/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = TelegramConnectSchema.parse(request.body);

    const adapter = new TelegramAdapter({
      botToken: body.botToken,
      chatId: body.chatId,
      notificationRepo: new PrismaNotificationRepository(fastify.prisma),
      outboxRepo: new PrismaOutboxRepository(fastify.prisma),
    });

    const health = await adapter.healthCheck(body.botToken);
    if (!health.isHealthy) {
      throw new Error('Invalid Telegram bot configuration');
    }

    const testMessage = await adapter.sendMessage('Test message from auto-job');
    if (!testMessage.success) {
      throw new Error('Failed to send test message');
    }

    return reply.send({
      success: true,
      message: 'Telegram configuration verified successfully',
    });
  });

  // DELETE /api/telegram/disconnect
  fastify.delete('/telegram/disconnect', async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.prisma.matchSettings.upsert({
      where: { userId: request.userId! },
      create: { userId: request.userId!, notifyOnMatch: false },
      update: {
        telegramBotTokenEncrypted: null,
        telegramChatId: null,
        telegramBotUsername: null,
        telegramConnectedAt: null,
        notifyOnMatch: false,
      },
    });

    return reply.send({
      success: true,
      message: 'Telegram bot disconnected successfully',
    });
  });
}