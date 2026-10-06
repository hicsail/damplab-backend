import { Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NOTIFICATION_LOG_TAG, notificationLogOnly } from './notification-log';
import { NotificationService } from './notification.service';
import { NotificationEmailService } from './notification-email.service';
import { NotificationEntity } from './notification.model';
import { EVENT_RECIPIENT_MAP, RecipientRole, notificationLink } from './notification.constants';
import { JobService } from '../job/job.service';
import { jobMemberEmails, jobPrimaryEmail } from '../job/job-membership';
import { normalizeClientEmail } from '../job/client-email';
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
  /** Keycloak subs for RecipientRole.NAMED_STAFF. Empty or absent → every staff member. */
  staffSubs?: string[];
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
    private readonly keycloakService: KeycloakService,
    @Optional() private readonly config?: ConfigService
  ) {}

  /** Log-only mode's account of a dispatch: what was decided and why, not just what was sent. */
  private trace(message: string): void {
    if (notificationLogOnly(this.config)) this.logger.log(`${NOTIFICATION_LOG_TAG} ${message}`);
  }

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
        this.trace(`${input.eventType}: no recipient config for this event type — nothing sent`);
        return;
      }

      const recipients = await this.resolveRecipients(config.recipients, input.jobId, input.staffSubs);

      // Exclude the actor if configured.
      const filtered = config.excludeActor && input.actorSub ? recipients.filter((r) => r.sub !== input.actorSub) : recipients;

      // Deduplicate by sub.
      const seen = new Set<string>();
      const unique = filtered.filter((r) => {
        if (seen.has(r.sub)) return false;
        seen.add(r.sub);
        return true;
      });

      this.trace(
        `${input.eventType}${input.jobId ? ` (job ${input.jobId})` : ''} by ${input.actorDisplayName ?? input.actorSub ?? 'system'}: ` +
          `${config.recipients.join('+') || 'resolved by caller'}${input.staffSubs ? ` [named: ${input.staffSubs.join(', ') || 'none — all staff'}]` : ''} → ` +
          `${unique.length ? unique.map((r) => r.email ?? r.sub).join(', ') : 'nobody'}` +
          `${filtered.length < recipients.length ? ` (actor excluded)` : ''}`
      );

      if (unique.length === 0) return;

      const link = notificationLink(input.eventType, input.jobId);

      // Check preferences and fan out.
      await Promise.all(
        unique.map(async (recipient) => {
          try {
            const prefs = await this.notificationService.getPreferences(recipient.sub);

            // In-app notification.
            const inAppDisabled = prefs.inAppDisabledEventTypes.includes(input.eventType);
            if (inAppDisabled) this.trace(`${input.eventType}: in-app skipped for ${recipient.email ?? recipient.sub} — turned off in their preferences`);
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
            if (config.emailWorthy && !recipient.email) this.trace(`${input.eventType}: no email for ${recipient.sub} — no address known`);
            if (config.emailWorthy && recipient.email) {
              const emailDisabled = prefs.emailDisabledEventTypes.includes(input.eventType);
              if (emailDisabled) this.trace(`${input.eventType}: email skipped for ${recipient.email} — turned off in their preferences`);
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

  private async resolveRecipients(roles: RecipientRole[], jobId?: string, staffSubs?: string[]): Promise<Recipient[]> {
    const recipients: Recipient[] = [];

    for (const role of roles) {
      switch (role) {
        case RecipientRole.JOB_OWNER: {
          if (!jobId) break;
          const job = await this.jobService.findById(jobId);
          if (!job) break;
          // The job's owner (B28: the client's sub on a staff-submitted job; the
          // staff submitter in submittedBy is never an owner recipient), then the
          // primary client and every member by email under a pseudo-sub (they may
          // have no account yet). Deduped by email, so a client whose sub and
          // clientEmail are both on the job hears once.
          const seenEmails = new Set<string>();
          if (job.sub) {
            recipients.push({ sub: job.sub, email: normalizeClientEmail(job.email) ?? job.email ?? undefined });
            const ownerEmail = normalizeClientEmail(job.email);
            if (ownerEmail) seenEmails.add(ownerEmail);
          }
          for (const email of [jobPrimaryEmail(job), ...jobMemberEmails(job)]) {
            if (!email || seenEmails.has(email)) continue;
            seenEmails.add(email);
            recipients.push({ sub: `email:${email}`, email });
          }
          break;
        }
        case RecipientRole.ALL_STAFF: {
          const staff = await this.getStaffMembers();
          recipients.push(...staff);
          break;
        }
        case RecipientRole.NAMED_STAFF: {
          const subs = [...new Set((staffSubs ?? []).filter((s) => typeof s === 'string' && s.trim()))];
          if (subs.length === 0) {
            recipients.push(...(await this.getStaffMembers()));
            break;
          }
          // One lookup each, and one failure costs only that person's email: the
          // in-app notification still reaches them by sub.
          for (const sub of subs) {
            try {
              const user = await this.keycloakService.getUserById(sub);
              recipients.push({ sub, email: user?.email ?? undefined });
            } catch (err: any) {
              this.logger.warn(`Could not look up staff member ${sub} for an email: ${err?.message}`);
              recipients.push({ sub });
            }
          }
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
