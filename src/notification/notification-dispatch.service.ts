import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationEmailService } from './notification-email.service';
import { NotificationEntity } from './notification.model';
import { EVENT_RECIPIENT_MAP, RecipientRole, notificationLink } from './notification.constants';
import { JobService } from '../job/job.service';
import { KeycloakService } from '../keycloak/keycloak.service';

export interface DispatchInput {
  eventType: string;
  title: string;
  message: string;
  jobId?: string;
  sowId?: string;
  actorSub?: string;
  actorDisplayName?: string;
  operationId?: string;
}

interface Recipient {
  sub: string;
  email?: string;
}

@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  /** Cached staff list with expiry. */
  private staffCache: { members: Recipient[]; expiresAt: number } | null = null;
  private static readonly STAFF_CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly notificationService: NotificationService,
    private readonly emailService: NotificationEmailService,
    @Inject(forwardRef(() => JobService))
    private readonly jobService: JobService,
    private readonly keycloakService: KeycloakService
  ) {}

  /**
   * Fire-and-forget notification dispatch. Resolves recipients, creates in-app
   * notifications, and sends emails for high-signal events. Failures are logged
   * but never thrown — the calling operation always succeeds.
   */
  dispatch(input: DispatchInput): void {
    void this.doDispatch(input);
  }

  private async doDispatch(input: DispatchInput): Promise<void> {
    try {
      const config = EVENT_RECIPIENT_MAP[input.eventType];
      if (!config) {
        this.logger.debug(`No recipient config for event type "${input.eventType}"; skipping`);
        return;
      }

      const recipients = await this.resolveRecipients(config.recipients, input.jobId);

      // Exclude the actor if configured.
      const filtered = config.excludeActor && input.actorSub ? recipients.filter((r) => r.sub !== input.actorSub) : recipients;

      // Deduplicate by sub.
      const seen = new Set<string>();
      const unique = filtered.filter((r) => {
        if (seen.has(r.sub)) return false;
        seen.add(r.sub);
        return true;
      });

      if (unique.length === 0) return;

      const link = notificationLink(input.eventType, input.jobId);

      // Check preferences and fan out.
      await Promise.all(
        unique.map(async (recipient) => {
          try {
            const prefs = await this.notificationService.getPreferences(recipient.sub);

            // In-app notification.
            const inAppDisabled = prefs.inAppDisabledEventTypes.includes(input.eventType);
            let notificationDoc: (NotificationEntity & { _id?: any }) | null = null;
            if (!inAppDisabled) {
              const opId = input.operationId ? `${input.operationId}:${recipient.sub}` : undefined;
              notificationDoc = opId
                ? await this.notificationService.createIdempotent({
                    recipientSub: recipient.sub,
                    recipientEmail: recipient.email,
                    eventType: input.eventType,
                    title: input.title,
                    message: input.message,
                    link,
                    jobId: input.jobId,
                    sowId: input.sowId,
                    actorDisplayName: input.actorDisplayName,
                    operationId: opId
                  })
                : await this.notificationService.create({
                    recipientSub: recipient.sub,
                    recipientEmail: recipient.email,
                    eventType: input.eventType,
                    title: input.title,
                    message: input.message,
                    link,
                    jobId: input.jobId,
                    sowId: input.sowId,
                    actorDisplayName: input.actorDisplayName
                  });
            }

            // Email (only for email-worthy events and if recipient has an email).
            if (config.emailWorthy && recipient.email) {
              const emailDisabled = prefs.emailDisabledEventTypes.includes(input.eventType);
              if (!emailDisabled) {
                this.emailService.send({
                  to: recipient.email,
                  subject: `[DampLab] ${input.title}`,
                  title: input.title,
                  message: input.message,
                  link
                });
                // Mark the notification doc as email-sent.
                if (notificationDoc?._id) {
                  await this.notificationService.markEmailSent(String(notificationDoc._id));
                }
              }
            }
          } catch (err: any) {
            this.logger.warn(`Failed to notify ${recipient.sub}: ${err?.message}`);
          }
        })
      );

      this.logger.log(`Dispatched "${input.eventType}" to ${unique.length} recipient(s)`);
    } catch (err: any) {
      this.logger.warn(`Notification dispatch failed for "${input.eventType}": ${err?.message}`);
    }
  }

  private async resolveRecipients(roles: RecipientRole[], jobId?: string): Promise<Recipient[]> {
    const recipients: Recipient[] = [];

    for (const role of roles) {
      switch (role) {
        case RecipientRole.JOB_OWNER: {
          if (!jobId) break;
          const job = await this.jobService.findById(jobId);
          if (!job) break;
          // The job owner is identified by sub; clientEmail is for staff-submitted jobs.
          if (job.sub) {
            recipients.push({
              sub: job.sub,
              email: job.email ?? undefined
            });
          }
          if (job.clientEmail) {
            // For staff-submitted jobs, the client may be a different person.
            // We don't have their sub, so use clientEmail as a pseudo-sub
            // to ensure they receive at least an email notification.
            recipients.push({
              sub: `email:${job.clientEmail}`,
              email: job.clientEmail
            });
          }
          break;
        }
        case RecipientRole.ALL_STAFF: {
          const staff = await this.getStaffMembers();
          recipients.push(...staff);
          break;
        }
      }
    }

    return recipients;
  }

  private async getStaffMembers(): Promise<Recipient[]> {
    const now = Date.now();
    if (this.staffCache && this.staffCache.expiresAt > now) {
      return this.staffCache.members;
    }

    try {
      const members = await this.keycloakService.getLabStaffGroupMembers();
      const recipients = members.map((m) => ({ sub: m.id, email: m.email }));
      this.staffCache = {
        members: recipients,
        expiresAt: now + NotificationDispatchService.STAFF_CACHE_TTL_MS
      };
      return recipients;
    } catch (err: any) {
      this.logger.warn(`Failed to fetch staff members: ${err?.message}`);
      return this.staffCache?.members ?? [];
    }
  }
}
