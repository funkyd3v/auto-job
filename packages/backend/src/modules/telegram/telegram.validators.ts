import { z } from 'zod';

export const TelegramConnectSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
});

export type TelegramConnectInput = z.infer<typeof TelegramConnectSchema>;
