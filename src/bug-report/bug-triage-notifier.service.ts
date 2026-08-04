import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BugReport } from './bug-report.model';

/**
 * Notifies the n8n bug-triage workflow that a new bug report was filed, so it can
 * dedupe, AI-triage and file a ClickUp card.
 *
 * Deliberately FIRE-AND-FORGET: a reporter submitting a bug must never see an
 * error, or wait, because an automation downstream is slow or down. Failures are
 * logged and swallowed — the BugReport is already safely persisted, and the card
 * can be created by hand or by a replay if triage misses one.
 */
@Injectable()
export class BugTriageNotifier {
  private readonly logger = new Logger(BugTriageNotifier.name);
  private readonly webhookUrl?: string;
  private readonly secret?: string;
  private readonly timeoutMs = 10000;

  constructor(private readonly configService: ConfigService) {
    this.webhookUrl = this.configService.get<string>('agent.bugTriageWebhookUrl');
    this.secret = this.configService.get<string>('agent.webhookSecret');
  }

  notify(bug: BugReport): void {
    if (!this.webhookUrl) return; // Integration not configured — silently no-op.
    void this.post(bug);
  }

  private async post(bug: BugReport): Promise<void> {
    const b = bug as any;
    const payload = {
      sourceBugId: String(b._id ?? b.id ?? ''),
      description: b.description ?? '',
      severity: b.severity ?? null,
      area: b.area ?? null,
      stepsToReproduce: b.stepsToReproduce ?? null,
      expected: b.expected ?? null,
      actual: b.actual ?? null,
      sessionTag: b.tag ?? null,
      reporterName: b.reporterName ?? null,
      reporterEmail: b.reporterEmail ?? null,
      attachmentCount: Array.isArray(b.attachments) ? b.attachments.length : 0,
      createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : new Date().toISOString()
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.webhookUrl as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.secret ? { 'x-agent-secret': this.secret } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!res.ok) {
        this.logger.warn(`Bug triage webhook returned ${res.status} for bug ${payload.sourceBugId}`);
      } else {
        this.logger.log(`Bug ${payload.sourceBugId} handed to triage`);
      }
    } catch (err: any) {
      this.logger.warn(`Bug triage webhook failed for bug ${payload.sourceBugId}: ${err?.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
