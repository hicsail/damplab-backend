export enum RecipientRole {
  JOB_OWNER = 'JOB_OWNER',
  ALL_STAFF = 'ALL_STAFF',
  /**
   * The staff the caller names in `DispatchInput.staffSubs` — for a booking, the
   * job's Project Manager and Project Lead from its SOW. Falls back to ALL_STAFF
   * when the caller names nobody, so a request is never unseen.
   */
  NAMED_STAFF = 'NAMED_STAFF'
}

export interface EventRecipientConfig {
  recipients: RecipientRole[];
  excludeActor?: boolean;
  emailWorthy?: boolean;
}

export const EVENT_RECIPIENT_MAP: Record<string, EventRecipientConfig> = {
  JOB_SUBMITTED: {
    recipients: [RecipientRole.ALL_STAFF],
    emailWorthy: true
  },
  JOB_REVIEWED: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true
  },
  JOB_REVIEW_RESPONSE: {
    recipients: [RecipientRole.ALL_STAFF],
    emailWorthy: true
  },
  SOW_SENT: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true
  },
  SOW_SIGNED: {
    recipients: [RecipientRole.ALL_STAFF],
    emailWorthy: true
  },
  SOW_FINALIZED: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true
  },
  // Billing. All go to the job owner and all are worth an email: the customer
  // hears about every change to their invoice. A recorded payment reissues the
  // invoice, so PAYMENT_RECORDED only fires on a job with no invoice standing.
  INVOICE_ISSUED: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true
  },
  INVOICE_VOIDED: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true
  },
  PAYMENT_RECORDED: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true
  },
  COMMENT_CREATED: {
    recipients: [RecipientRole.JOB_OWNER, RecipientRole.ALL_STAFF],
    excludeActor: true,
    emailWorthy: true
  },
  INTERNAL_COMMENT_CREATED: {
    recipients: [RecipientRole.ALL_STAFF],
    excludeActor: true,
    emailWorthy: true
  },
  LAB_NODE_ASSIGNED: {
    recipients: [RecipientRole.ALL_STAFF],
    excludeActor: true,
    emailWorthy: false
  },
  LAB_NODE_STATE_CHANGED: {
    recipients: [RecipientRole.ALL_STAFF],
    excludeActor: true,
    emailWorthy: false
  },
  // Equipment booking. A client's booking (or change to one) waits on the lab;
  // the job's Project Manager and Project Lead hear about it, and the client hears
  // the answer.
  EQUIPMENT_BOOKING_REQUESTED: {
    recipients: [RecipientRole.NAMED_STAFF],
    excludeActor: true,
    emailWorthy: true
  },
  EQUIPMENT_BOOKING_APPROVED: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true
  },
  EQUIPMENT_BOOKING_DECLINED: {
    recipients: [RecipientRole.JOB_OWNER],
    emailWorthy: true
  },
  // Bug tracking. Recipient is resolved from the BugReport, not via roles.
  BUG_DEPLOYED_TO_STAGING: {
    recipients: [],
    emailWorthy: true
  }
};

/**
 * The job page a notification opens.
 *
 * An event only staff receive links to the staff job page. The in-app bell
 * rewrites a client link for staff, but an email has no bell: a Project Manager
 * opening `/client_view/:id` for a job they are not on finds nothing, which is
 * the one page an approval request must not dead-end on. An event that reaches a
 * client links to the client page, which the bell rewrites for any staff
 * recipient.
 */
export function notificationLink(eventType: string, jobId?: string): string | undefined {
  if (!jobId) return undefined;
  const recipients = EVENT_RECIPIENT_MAP[eventType]?.recipients ?? [];
  const staffOnly = recipients.length > 0 && recipients.every((r) => r === RecipientRole.ALL_STAFF || r === RecipientRole.NAMED_STAFF);
  return staffOnly ? `/technician_view/${jobId}` : `/client_view/${jobId}`;
}
