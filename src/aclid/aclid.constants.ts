export const ACLID_MIN_SEQUENCE_LENGTH = 30;
export const ACLID_POLL_INTERVAL_MS = 3000;
/** The budget for a whole screen — create POST and every poll inside it. */
export const ACLID_POLL_TIMEOUT_MS = 120_000;
/** Per-request ceiling, so one hung socket cannot eat the whole poll budget. */
export const ACLID_REQUEST_TIMEOUT_MS = 30_000;
