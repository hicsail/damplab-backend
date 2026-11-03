import { HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CustomerScreeningStatus } from '../job/screening-run.model';
import { customerScreeningStatus } from './aclid-status.util';
import { ACLID_CUSTOMER_POLL_TIMEOUT_MS, ACLID_DETAILS_MAX_MATCHES_PER_REGION, ACLID_POLL_INTERVAL_MS, ACLID_POLL_TIMEOUT_MS, ACLID_REQUEST_TIMEOUT_MS } from './aclid.constants';

/**
 * Talks to Aclid (https://api.aclid.bio) over HTTP.
 *
 * Plain `fetch`, like SecureDNA and every other outbound integration here.
 *
 * Unreachable is not the same as denied. Anything that stops us getting an
 * answer — no key configured, connection refused, a timeout, a non-2xx, a
 * malformed body — raises an HttpException, and the caller records the
 * screening as unavailable. Only a real regulatory / decision status from Aclid
 * is a verdict.
 *
 * Aclid authenticates with the raw API key in `Authorization` (no `Bearer`). The key comes from
 * the first non-empty of `ACLID_PROD_API_KEY`, `ACLID_TEST_API_KEY`, then legacy `ACLID_API_KEY`.
 * Customer screening goes through `POST /v2/customers` and
 * `GET /v2/customers/{requester_id}`. Hosted KYC remains for the customer page:
 * the verification URL is minted per screen by `createVerificationUrl`.
 */

export const ACLID_DEFAULT_API_URL = 'https://api.aclid.bio';

/** Screen statuses after which Aclid will not change `status` again. */
export const ACLID_TERMINAL_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'failed', 'deleted', 'archived']);

export interface AclidScreenRecord {
  id: string;
  status: string;
  regulatoryStatus: string | null;
  verificationStatus: string | null;
  decisionStatus: string | null;
  verificationCompletedAt: string | null;
  findings: Record<string, unknown> | null;
  /** `match_count`: alignments across every sequence in the screen. */
  matchCount: number | null;
  /** `material_count`: unique controlled materials. */
  materialCount: number | null;
  /** `length`: cumulative length of every sequence. */
  totalLength: number | null;
  /** `material_summary`: material name → MaterialSummary. */
  materialSummary: Record<string, unknown> | null;
  /** The body exactly as Aclid sent it (`ReportMetadata`), kept on the screening run. */
  raw: Record<string, unknown>;
}

export interface AclidInlineSequence {
  name: string;
  sequence: string;
}

export interface AclidScreenInlineArgs {
  name: string;
  sequences: AclidInlineSequence[];
}

export interface AclidVerificationUrlArgs {
  screenId: string;
  redirectUrl?: string;
}

export interface AclidCustomerRecord {
  requesterId: string;
  status: CustomerScreeningStatus;
  verdict: string | null;
  decisionStatus: string | null;
  checks: unknown[] | null;
  counts: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface AclidCreateCustomerArgs {
  name: string;
  company: string;
  email?: string | null;
  screenId: string;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Aclid's snake_case screen body → our camelCase record. Missing fields are null, never undefined. */
export function mapAclidScreen(raw: unknown): AclidScreenRecord {
  if (!isJsonObject(raw) || typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new HttpException('Aclid returned a screen without an id', HttpStatus.BAD_GATEWAY);
  }
  return {
    id: raw.id,
    status: stringOrNull(raw.status) ?? 'unknown',
    regulatoryStatus: stringOrNull(raw.regulatory_status),
    verificationStatus: stringOrNull(raw.verification_status),
    decisionStatus: stringOrNull(raw.decision_status),
    verificationCompletedAt: stringOrNull(raw.verification_completed_at),
    findings: isJsonObject(raw.findings) ? raw.findings : null,
    matchCount: numberOrNull(raw.match_count),
    materialCount: numberOrNull(raw.material_count),
    totalLength: numberOrNull(raw.length),
    materialSummary: isJsonObject(raw.material_summary) ? raw.material_summary : null,
    raw
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A screen Aclid created that we stopped watching before it finished — the poll
 * budget ran out, or a poll request failed.
 *
 * Distinct from every other failure because the screen is real: it exists at
 * Aclid, it will reach a verdict, and the customer's KYC hangs off its id. The
 * caller must persist that id rather than record a null one, or the screen
 * becomes unreachable from our side.
 */
export class AclidScreenPendingError extends HttpException {
  constructor(readonly screen: AclidScreenRecord, reason: string) {
    super(`Aclid screen ${screen.id} ${reason}`, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

/** Aclid answered 403 because the organization does not have the `sanctions` feature switched on. */
export class AclidFeatureNotEnabledError extends HttpException {
  constructor(detail: string) {
    super(`Aclid: ${detail}`, HttpStatus.BAD_GATEWAY);
  }
}

/**
 * A customer Aclid created that has not reached a verdict inside the poll budget.
 * Carries the latest record so the caller keeps the requester id.
 */
export class AclidCustomerPendingError extends HttpException {
  constructor(readonly customer: AclidCustomerRecord) {
    super(`Aclid customer ${customer.requesterId} did not finish within ${ACLID_CUSTOMER_POLL_TIMEOUT_MS} ms`, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

function mapAclidCustomer(raw: unknown): AclidCustomerRecord {
  if (!isJsonObject(raw) || typeof raw.requester_id !== 'string' || raw.requester_id.length === 0) {
    throw new HttpException('Aclid customer response did not include a requester_id', HttpStatus.BAD_GATEWAY);
  }
  const review = isJsonObject(raw.review) ? raw.review : null;
  const verdict = stringOrNull(review?.verdict);
  const decisionStatus = stringOrNull(raw.decision_status);
  return {
    requesterId: raw.requester_id,
    status: customerScreeningStatus(verdict, decisionStatus),
    verdict,
    decisionStatus,
    checks: Array.isArray(review?.checks) ? review.checks : null,
    counts: isJsonObject(review?.counts) ? review.counts : null,
    raw
  };
}

/** Time left on a deadline, clamped so a request always gets a live signal. */
function remainingMs(deadline: number): number {
  return Math.max(1, Math.min(ACLID_REQUEST_TIMEOUT_MS, deadline - Date.now()));
}

/** Key variables in precedence order: production wins, then the test key, then the legacy name. */
export const ACLID_KEY_VARIABLES = ['ACLID_PROD_API_KEY', 'ACLID_TEST_API_KEY', 'ACLID_API_KEY'] as const;
export type AclidKeyVariable = typeof ACLID_KEY_VARIABLES[number];

/** The first non-empty (trimmed) Aclid key and the variable it came from, or null when none is set. */
export function resolveAclidApiKey(env: NodeJS.ProcessEnv = process.env): { key: string; source: AclidKeyVariable } | null {
  for (const source of ACLID_KEY_VARIABLES) {
    const key = env[source]?.trim();
    if (key) return { key, source };
  }
  return null;
}

@Injectable()
export class AclidService implements OnModuleInit {
  private readonly logger = new Logger(AclidService.name);

  /** Says which variable supplies the key, never the key itself. */
  onModuleInit(): void {
    const resolved = resolveAclidApiKey();
    this.logger.log(resolved ? `Aclid: key from ${resolved.source}` : 'Aclid: not configured');
  }

  /** True when an API key is configured at all. Without one, Aclid is skipped, not failed. */
  isConfigured(): boolean {
    return resolveAclidApiKey() !== null;
  }

  private apiKey(): string {
    const resolved = resolveAclidApiKey();
    if (!resolved) {
      throw new HttpException('Aclid is not configured: set ACLID_TEST_API_KEY or ACLID_PROD_API_KEY', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return resolved.key;
  }

  private baseUrl(): string {
    const raw = process.env.ACLID_API_URL?.trim() || ACLID_DEFAULT_API_URL;
    return raw.replace(/\/+$/, '');
  }

  /**
   * One request to Aclid. Transport failures are SERVICE_UNAVAILABLE; anything
   * Aclid answered with that we cannot use (non-2xx, non-JSON) is BAD_GATEWAY.
   */
  private async request(method: 'GET' | 'POST', path: string, body?: JsonObject, timeoutMs: number = ACLID_REQUEST_TIMEOUT_MS): Promise<unknown> {
    const url = `${this.baseUrl()}${path}`;
    const headers: Record<string, string> = { Authorization: this.apiKey() };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // A single hung socket must not outlive the poll deadline: callers
        // polling a screen pass what is left of it.
        signal: AbortSignal.timeout(Math.max(1, timeoutMs))
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpException(`Could not reach Aclid at ${url}: ${reason}`, HttpStatus.SERVICE_UNAVAILABLE);
    }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      this.logger.warn(`Aclid ${method} ${path} returned ${res.status}`);
      if (res.status === 403) {
        let detail: unknown;
        try {
          detail = (JSON.parse(text) as JsonObject | null)?.detail;
        } catch {
          // Not JSON: an ordinary 403.
        }
        if (typeof detail === 'string' && detail.includes('is not enabled for your organization')) {
          throw new AclidFeatureNotEnabledError(detail);
        }
      }
      throw new HttpException(`Aclid returned ${res.status}${text ? `: ${text.slice(0, 500)}` : ''}`, HttpStatus.BAD_GATEWAY);
    }
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpException('Aclid returned a body that is not JSON', HttpStatus.BAD_GATEWAY);
    }
  }

  /** `GET /v2/screens/{id}` — the current state of one screen. */
  async getScreen(screenId: string, timeoutMs?: number): Promise<AclidScreenRecord> {
    const raw = await this.request('GET', `/v2/screens/${encodeURIComponent(screenId)}`, undefined, timeoutMs);
    return mapAclidScreen(raw);
  }

  /**
   * `GET /v2/screens/{id}/details` — each sequence's matches, findings and regulatory
   * status, keyed by the name it was sent under (`MatchGroup`). Null while the screen is not
   * complete: Aclid answers 204 with no body, which `request` returns as null.
   */
  async getScreenDetails(screenId: string): Promise<Record<string, unknown> | null> {
    const raw = await this.request('GET', `/v2/screens/${encodeURIComponent(screenId)}/details?max_match_count_per_region=${ACLID_DETAILS_MAX_MATCHES_PER_REGION}`);
    if (raw === null) return null;
    if (!isJsonObject(raw)) throw new HttpException('Aclid returned screen details that are not an object', HttpStatus.BAD_GATEWAY);
    return raw;
  }

  /**
   * `POST /v2/screen_inline` with `asynchronous: true`, then poll
   * `GET /v2/screens/{id}` until the status is terminal or
   * ACLID_POLL_TIMEOUT_MS passes. The first poll is immediate; the interval
   * only applies between polls.
   *
   * The deadline covers the create POST too, because a staff rerun awaits this
   * call: the bound has to be the whole operation's, not each half's.
   *
   * A screen that outlives the deadline raises `AclidScreenPendingError`, which
   * carries the id — see that class for why losing it is worse than losing the
   * verdict.
   */
  async screenInline(args: AclidScreenInlineArgs): Promise<AclidScreenRecord> {
    if (args.sequences.length === 0) {
      throw new HttpException('No sequences to screen', HttpStatus.BAD_REQUEST);
    }

    const deadline = Date.now() + ACLID_POLL_TIMEOUT_MS;
    const created = await this.request(
      'POST',
      '/v2/screen_inline',
      {
        name: args.name,
        asynchronous: true,
        sequences: args.sequences.map((s) => ({ name: s.name, sequence: s.sequence }))
      },
      remainingMs(deadline)
    );

    const firstItem = isJsonObject(created) && Array.isArray(created.items) ? created.items[0] : created;
    const initial = mapAclidScreen(firstItem);
    if (ACLID_TERMINAL_STATUSES.has(initial.status)) {
      return initial;
    }

    let latest = initial;
    for (;;) {
      try {
        latest = await this.getScreen(initial.id, remainingMs(deadline));
      } catch (error) {
        throw new AclidScreenPendingError(latest, `could not be read back: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (ACLID_TERMINAL_STATUSES.has(latest.status)) {
        return latest;
      }
      if (Date.now() + ACLID_POLL_INTERVAL_MS > deadline) {
        break;
      }
      await sleep(ACLID_POLL_INTERVAL_MS);
    }
    throw new AclidScreenPendingError(latest, `did not finish within ${ACLID_POLL_TIMEOUT_MS} ms`);
  }

  /**
   * `POST /v2/verification_url/` — mint Aclid's hosted KYC page for one screen.
   * The customer completes verification there. Creating the Aclid customer for a
   * job is a separate call, `createCustomer`.
   */
  async createVerificationUrl(args: AclidVerificationUrlArgs): Promise<string> {
    const body: JsonObject = { screen_id: args.screenId };
    if (args.redirectUrl?.trim()) {
      body.redirect_url = args.redirectUrl.trim();
    }
    const raw = await this.request('POST', '/v2/verification_url/', body);
    const url = isJsonObject(raw) ? stringOrNull(raw.url) : null;
    if (!url) {
      throw new HttpException('Aclid verification_url response did not include a url', HttpStatus.BAD_GATEWAY);
    }
    return url;
  }

  /** `POST /v2/customers` — start sanctions / watchlist screening of one customer, tied to a screen. */
  async createCustomer(args: AclidCreateCustomerArgs): Promise<{ requesterId: string; status: string }> {
    const body: JsonObject = { name: args.name, company: args.company, screen_id: args.screenId };
    if (args.email?.trim()) {
      body.email = args.email.trim();
    }
    const raw = await this.request('POST', '/v2/customers', body);
    if (!isJsonObject(raw) || typeof raw.requester_id !== 'string' || raw.requester_id.length === 0) {
      throw new HttpException('Aclid customer response did not include a requester_id', HttpStatus.BAD_GATEWAY);
    }
    return { requesterId: raw.requester_id, status: stringOrNull(raw.status) ?? 'unknown' };
  }

  /** `GET /v2/customers/{requester_id}` — the customer's current review. */
  async getCustomer(requesterId: string, timeoutMs?: number): Promise<AclidCustomerRecord> {
    const raw = await this.request('GET', `/v2/customers/${encodeURIComponent(requesterId)}`, undefined, timeoutMs);
    return mapAclidCustomer(raw);
  }

  /**
   * Read the customer until its status is not IN_PROGRESS, for at most
   * ACLID_CUSTOMER_POLL_TIMEOUT_MS. The first read is immediate. A read error
   * propagates; running out of budget raises `AclidCustomerPendingError`.
   */
  async pollCustomer(requesterId: string): Promise<AclidCustomerRecord> {
    const deadline = Date.now() + ACLID_CUSTOMER_POLL_TIMEOUT_MS;
    for (;;) {
      const latest = await this.getCustomer(requesterId, remainingMs(deadline));
      if (latest.status !== CustomerScreeningStatus.IN_PROGRESS) {
        return latest;
      }
      if (Date.now() + ACLID_POLL_INTERVAL_MS > deadline) {
        throw new AclidCustomerPendingError(latest);
      }
      await sleep(ACLID_POLL_INTERVAL_MS);
    }
  }
}
