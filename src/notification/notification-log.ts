import { ConfigService } from '@nestjs/config';

/**
 * Log-only notifications, for testing locally.
 *
 * With `NOTIFICATION_LOG_ONLY=true`, every notification is written to the backend
 * log instead of leaving the machine: each dispatch (event, who it resolved to, and
 * why anyone was skipped), each in-app notification as it is stored, and each email
 * in full — recipient, subject, link and text. No email is sent, whatever
 * `NOTIFICATION_EMAIL_ENABLED` says and with or without a Mailgun key, so a local
 * database full of real addresses can be exercised safely.
 *
 * Off unless set. Never set it on staging or production: emails would stop.
 * Every line starts with NOTIFICATION_LOG_TAG, so `grep '\[notifications\]'` on
 * the backend's output shows the whole story of one action.
 */
export const NOTIFICATION_LOG_TAG = '[notifications]';

export function notificationLogOnly(config?: Pick<ConfigService, 'get'> | null): boolean {
  return String(config?.get('notifications.logOnly') ?? '') === 'true';
}

/** An email as it would have been sent, as one readable log entry. */
export function formatEmailForLog(input: { to: string; subject: string; message: string; linkUrl: string }): string {
  return [`${NOTIFICATION_LOG_TAG} email (not sent — log-only) to=${input.to}`, `  subject: ${input.subject}`, `  link:    ${input.linkUrl}`, `  body:    ${input.message}`].join('\n');
}
