export const ACLID_MIN_SEQUENCE_LENGTH = 30;
export const ACLID_POLL_INTERVAL_MS = 3000;
/** The budget for a whole screen — create POST and every poll inside it. */
export const ACLID_POLL_TIMEOUT_MS = 120_000;
/** Per-request ceiling, so one hung socket cannot eat the whole poll budget. */
export const ACLID_REQUEST_TIMEOUT_MS = 30_000;
/** `max_match_count_per_region` on `GET /v2/screens/{id}/details` (Aclid's default and our ask). */
export const ACLID_DETAILS_MAX_MATCHES_PER_REGION = 25;
