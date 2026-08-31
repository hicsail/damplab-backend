import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendEmailInput {
  to: string;
  subject: string;
  title: string;
  message: string;
  link?: string;
}

@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);
  private readonly apiKey?: string;
  private readonly domain: string;
  private readonly fromAddress: string;
  private readonly enabled: boolean;
  private readonly appBaseUrl: string;
  private readonly timeoutMs = 10_000;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('notifications.mailgunApiKey');
    this.domain = this.configService.get<string>('notifications.mailgunDomain') ?? 'mail.sail.codes';
    this.fromAddress = this.configService.get<string>('notifications.mailgunFromAddress') ?? 'DampLab <noreply@mail.sail.codes>';
    this.enabled = this.configService.get<string>('notifications.emailEnabled') === 'true';
    this.appBaseUrl = this.configService.get<string>('notifications.appBaseUrl') ?? 'https://damplab-canvas.sail.codes';
  }

  /** Fire-and-forget: caller should not await this. */
  send(input: SendEmailInput): void {
    if (!this.enabled) return;
    if (!this.apiKey) {
      this.logger.warn('Mailgun API key not configured; skipping email');
      return;
    }
    void this.post(input);
  }

  private async post(input: SendEmailInput): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `https://api.mailgun.net/v3/${this.domain}/messages`;
      const body = new URLSearchParams();
      body.append('from', this.fromAddress);
      body.append('to', input.to);
      body.append('subject', input.subject);
      body.append('html', this.buildHtml(input));

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString(),
        signal: controller.signal
      });

      if (!res.ok) {
        this.logger.warn(`Mailgun returned ${res.status}: ${await res.text()}`);
      } else {
        this.logger.log(`Email sent to ${input.to}: "${input.subject}"`);
      }
    } catch (err: any) {
      this.logger.warn(`Mailgun send failed: ${err?.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHtml(input: SendEmailInput): string {
    const linkUrl = input.link ? `${this.appBaseUrl}${input.link}` : this.appBaseUrl;
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="border-bottom: 3px solid #1565c0; padding-bottom: 12px; margin-bottom: 24px;">
    <h2 style="margin: 0; color: #1565c0;">DampLab</h2>
  </div>
  <h3 style="margin: 0 0 8px;">${this.escapeHtml(input.title)}</h3>
  <p style="margin: 0 0 24px; line-height: 1.6;">${this.escapeHtml(input.message)}</p>
  <a href="${this.escapeHtml(
    linkUrl
  )}" style="display: inline-block; padding: 12px 24px; background: #1565c0; color: #fff; text-decoration: none; border-radius: 4px; font-weight: 500;">View in DampLab</a>
  <hr style="margin: 32px 0 16px; border: none; border-top: 1px solid #e0e0e0;">
  <p style="font-size: 12px; color: #999;">You received this email because of activity on DampLab Canvas. You can manage your notification preferences in the app.</p>
</body>
</html>`.trim();
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
