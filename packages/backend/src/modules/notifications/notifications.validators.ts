import { z } from 'zod';

export const NotificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  channel: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
});

export type NotificationQueryInput = z.infer<typeof NotificationQuerySchema>;

export const UpdateNotificationStatusSchema = z.object({
  status: z.enum(['PENDING', 'SENT', 'FAILED']),
});

export type UpdateNotificationStatusInput = z.infer<typeof UpdateNotificationStatusSchema>;

export const TelegramConnectSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
});

export type TelegramConnectInput = z.infer<typeof TelegramConnectSchema>;
