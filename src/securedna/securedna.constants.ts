/**
 * Guard on one screening request. SecureDNA's own batch ceiling is far above
 * anything a DAMPLab job produces — a job with more sequence fields than this
 * is a bug upstream, not a large order.
 */
export const MAX_SECUREDNA_SEQUENCE_BATCH = 1000;

/** Default when `SECUREDNA_REQUEST_TIMEOUT_MS` is unset. */
export const SECUREDNA_REQUEST_TIMEOUT_MS = 120_000;
