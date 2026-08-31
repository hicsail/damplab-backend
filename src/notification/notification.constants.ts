export enum RecipientRole {
  JOB_OWNER = 'JOB_OWNER',
  ALL_STAFF = 'ALL_STAFF',
}

export interface EventRecipientConfig {
  recipients: RecipientRole[];
  excludeActor?: boolean;
  emailWorthy?: boolean;
}

export const EVENT_RECIPIENT_MAP: Record<string, EventRecipientConfig> = {
  JOB_SUBMITTED: {
    recipients: [RecipientRole.ALL_STAFF],
    emailWorthy: true,
  },
  JOB_REVIEWED: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true,
  },
  JOB_REVIEW_RESPONSE: {
    recipients: [RecipientRole.ALL_STAFF],
    emailWorthy: true,
  },
  SOW_SENT: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true,
  },
  SOW_SIGNED: {
    recipients: [RecipientRole.ALL_STAFF],
    emailWorthy: true,
  },
  SOW_FINALIZED: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true,
  },
  COMMENT_CREATED: {
    recipients: [RecipientRole.JOB_OWNER, RecipientRole.ALL_STAFF],
    excludeActor: true,
    emailWorthy: false,
  },
  LAB_NODE_ASSIGNED: {
    recipients: [RecipientRole.ALL_STAFF],
    excludeActor: true,
    emailWorthy: false,
  },
  LAB_NODE_STATE_CHANGED: {
    recipients: [RecipientRole.ALL_STAFF],
    excludeActor: true,
    emailWorthy: false,
  },
};

/** Event types that should generate a link to the job detail page. */
export function notificationLink(eventType: string, jobId?: string): string | undefined {
  if (!jobId) return undefined;
  // Staff-facing events link to the technician view; client-facing link to client view.
  // The frontend router handles redirects based on the user's role.
  return `/job/${jobId}`;
}
