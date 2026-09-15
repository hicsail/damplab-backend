import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ACLID_POLL_INTERVAL_MS, ACLID_POLL_TIMEOUT_MS, ACLID_REQUEST_TIMEOUT_MS } from './aclid.constants';

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
 * Aclid authenticates with the raw API key in `Authorization` (no `Bearer`).
 * This service never creates customers: KYC is done through Aclid's hosted
 * verification URL, minted per screen by `createVerificationUrl`.
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

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
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
    findings: isJsonObject(raw.findings) ? raw.findings : null
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

/** Time left on a deadline, clamped so a request always gets a live signal. */
function remainingMs(deadline: number): number {
  return Math.max(1, Math.min(ACLID_REQUEST_TIMEOUT_MS, deadline - Date.now()));
}

@Injectable()
export class AclidService {
  private readonly logger = new Logger(AclidService.name);

  /** True when an API key is configured at all. Without one, Aclid is skipped, not failed. */
  isConfigured(): boolean {
    return Boolean(process.env.ACLID_API_KEY?.trim());
  }

  private apiKey(): string {
    const key = process.env.ACLID_API_KEY?.trim();
    if (!key) {
      throw new HttpException('Aclid is not configured: set ACLID_API_KEY', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return key;
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
   * The customer completes verification there; we never create Aclid customers
   * ourselves.
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
}
