import { Bot, InlineKeyboard } from 'grammy';
import type { Job } from '@prisma/client';
import type { INotificationRepository, IOutboxRepository } from '../notifications/notifications.repository.js';

// ─── Telegram Adapter (SRP) ─────────────────────────────────────────────────────────

export interface TelegramAdapterDependencies {
  botToken: string;
  chatId: string;
  notificationRepo: INotificationRepository;
  outboxRepo: IOutboxRepository;
}

export class TelegramAdapter {
  private bot: Bot;
  private chatId: string;
  private notificationRepo: INotificationRepository;
  private outboxRepo: IOutboxRepository;

  constructor(dependencies: TelegramAdapterDependencies) {
    this.bot = new Bot(dependencies.botToken);
    this.chatId = dependencies.chatId;
    this.notificationRepo = dependencies.notificationRepo;
    this.outboxRepo = dependencies.outboxRepo;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async healthCheck(botToken?: string): Promise<{ isHealthy: boolean; botInfo?: any; error?: string }> {
    try {
      const testBot = botToken ? new Bot(botToken) : this.bot;
      const botInfo = await testBot.api.getMe();
      return { isHealthy: true, botInfo };
    } catch (error) {
      return { isHealthy: false, error: String(error) };
    }
  }

  async sendMessage(text: string, options?: { parse_mode?: 'HTML' | 'Markdown' }): Promise<{ messageId: number; success: boolean }> {
    try {
      const result = await this.bot.api.sendMessage(this.chatId, text, {
        parse_mode: options?.parse_mode ?? 'HTML',
      });
      return { messageId: result.message_id, success: true };
    } catch (error) {
      throw new Error(`Failed to send message: ${String(error)}`);
    }
  }

  async sendJobNotification(job: Job, matchScore: number): Promise<{ messageId: string; success: boolean }> {
    const keyboard = new InlineKeyboard()
      .text('View Job', `job:${job.id}:view`)
      .text('Save', `job:${job.id}:save`)
      .row()
      .text('Applied', `job:${job.id}:applied`)
      .text('Interview', `job:${job.id}:interview`)
      .row()
      .text('Reject', `job:${job.id}:reject`)
      .text('Archive', `job:${job.id}:archive`);

    const message = `
<b>New Job Match!</b>

<b>Company:</b> ${this.escapeHtml(job.company || 'N/A')}
<b>Position:</b> ${this.escapeHtml(job.title)}
<b>Location:</b> ${this.escapeHtml(job.location || 'N/A')}

<b>Match Score:</b> ${matchScore}%

<b>Description:</b>
${this.escapeHtml(job.description.substring(0, 300))}${job.description.length > 300 ? '...' : ''}

${job.url ? `\n<b>Link:</b> <a href="${this.escapeHtml(job.url)}">View Original Listing</a>` : ''}

<i>Discovered: ${new Date(job.scrapedAt).toLocaleDateString()}</i>
    `.trim();

    const result = await this.sendMessage(message);
    
    return {
      messageId: result.messageId.toString(),
      success: true,
    };
  }

  async setupCallbackHandlers(): Promise<void> {
    this.bot.callbackQuery(/^job:(.+):(.+)$/, async (ctx) => {
      const [, jobId, action] = ctx.match;
      
      await ctx.answerCallbackQuery();
      
      switch (action) {
        case 'view':
          await ctx.reply(`Viewing job ${jobId}`);
          break;
        case 'save':
          await ctx.reply(`Job ${jobId} saved`);
          break;
        case 'applied':
          await ctx.reply(`Job ${jobId} marked as applied`);
          break;
        case 'interview':
          await ctx.reply(`Job ${jobId} marked as interview`);
          break;
        case 'reject':
          await ctx.reply(`Job ${jobId} rejected`);
          break;
        case 'archive':
          await ctx.reply(`Job ${jobId} archived`);
          break;
      }
    });
  }

  startPolling(): void {
    this.bot.start({
      onStart: () => {
        console.log('Telegram bot started polling');
      },
    });
  }

  stopPolling(): void {
    this.bot.stop();
  }
}
