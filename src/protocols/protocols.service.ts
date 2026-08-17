import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Compare two protocols.io step numbers ("3", "4.1", "5.10") by numeric segment.
 *
 * protocols.io returns steps ordered by internal `id` — i.e. database insertion
 * order, NOT presentation order. Observed on protocol 313875: step "1" arrives
 * 24th of 30. So we have to sort ourselves.
 *
 * Two wrinkles rule out the obvious approaches:
 *  - A plain string sort puts "5.10" before "5.2".
 *  - `number` is NOT unique. Protocols with branches (`cases`) repeat numbering,
 *    e.g. 313875 has two each of 5.1 / 7 / 7.1 / 7.2 / 8 / 8.1 / 8.2. So the
 *    caller must keep a stable tiebreaker rather than assume a total order.
 *  - `previous_id` looks like a linked list but branches (two steps can share a
 *    predecessor), so it can't be walked to a single linear sequence either.
 */
function compareStepNumbers(a: string, b: string): number {
  const segsA = String(a ?? '').split('.');
  const segsB = String(b ?? '').split('.');
  const len = Math.max(segsA.length, segsB.length);
  for (let i = 0; i < len; i++) {
    // Three cases per segment, and they must stay distinct:
    //   absent      → -Infinity, so a parent precedes its substeps ("5" < "5.1")
    //   numeric     → its value, compared numerically ("5.2" < "5.10")
    //   non-numeric → +Infinity, so oddities sort to the end
    const va = segValue(segsA, i);
    const vb = segValue(segsB, i);
    // Compare rather than subtract: -Infinity - -Infinity is NaN.
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function segValue(segs: string[], i: number): number {
  if (i >= segs.length) return Number.NEGATIVE_INFINITY;
  const n = Number.parseFloat(segs[i]);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/** One renderable protocol step, normalized for the technician bench view. */
export interface ProtocolStep {
  /** Stable per-step identifier (protocols.io step guid) — used as the checklist key. */
  id: string;
  /** Step number as shown in protocols.io (e.g. "3", "4.1"). */
  number: string;
  /** Sanitized HTML body of the step. */
  html: string;
}

/** Normalized protocol shape returned to the client. Protocol content is fetched on demand, never stored. */
export interface ProtocolView {
  id: string;
  title: string;
  url: string;
  description: string;
  steps: ProtocolStep[];
}

/**
 * Reads protocols from protocols.io on the server side so the API token never
 * reaches the browser. We only READ (no sync/import): given a service's stored
 * protocolId, fetch the protocol metadata + steps for inline display.
 */
@Injectable()
export class ProtocolsService {
  private readonly logger = new Logger(ProtocolsService.name);
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('protocolsio.apiKey');
    this.baseUrl = (this.configService.get<string>('protocolsio.apiBaseUrl') || 'https://www.protocols.io/api/v4').replace(/\/$/, '');
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** Call the protocols.io API. Their convention: HTTP 200 with payload.status_code === 0 on success. */
  private async call(path: string): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' }
      });
    } catch (err: any) {
      this.logger.error(`protocols.io request failed: ${err?.message}`);
      throw new ServiceUnavailableException('Could not reach protocols.io.');
    }
    if (res.status === 404) {
      throw new NotFoundException('Protocol not found on protocols.io.');
    }
    if (!res.ok) {
      this.logger.error(`protocols.io returned ${res.status} for ${path}`);
      throw new ServiceUnavailableException(`protocols.io error (${res.status}).`);
    }
    const json = await res.json().catch(() => null);
    if (json && typeof json.status_code === 'number' && json.status_code !== 0) {
      // 1 = no protocol, others = various API errors.
      if (json.status_code === 1) throw new NotFoundException('Protocol not found on protocols.io.');
      throw new ServiceUnavailableException(`protocols.io error (status ${json.status_code}).`);
    }
    return json;
  }

  /**
   * Fetch a protocol by its protocols.io identifier (short slug like "n92ld46yxl5b"
   * or numeric id). Resolves the slug to the numeric id, then pulls the steps.
   */
  async getProtocol(idOrSlug: string): Promise<ProtocolView> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('protocols.io is not configured (missing API key).');
    }
    const id = encodeURIComponent(String(idOrSlug || '').trim());
    if (!id) throw new NotFoundException('No protocol id provided.');

    const meta = await this.call(`/protocols/${id}`);
    const p = meta?.payload ?? {};
    const numericId = p.id;

    let steps: ProtocolStep[] = [];
    if (numericId) {
      try {
        const stepsRes = await this.call(`/protocols/${numericId}/steps?content_format=html`);
        const list = Array.isArray(stepsRes?.payload) ? stepsRes.payload : [];
        steps = list
          .map((st: any, idx: number) => ({
            id: String(st?.guid ?? st?.id ?? ''),
            number: String(st?.number ?? ''),
            html: typeof st?.step === 'string' ? st.step : '',
            // Preserve API position as a stable tiebreaker for duplicate numbers.
            _idx: idx
          }))
          // Require an id only. Previously we also required non-empty html, which
          // silently DROPPED steps that carry no body (e.g. section headers), so
          // the checklist skipped numbers.
          .filter((s: ProtocolStep & { _idx: number }) => s.id)
          .sort((a: any, b: any) => compareStepNumbers(a.number, b.number) || a._idx - b._idx)
          .map(({ _idx, ...s }: any) => s as ProtocolStep);
      } catch (err: any) {
        // Steps are best-effort: still return metadata + the deep link if steps fail.
        this.logger.warn(`protocols.io steps fetch failed for ${numericId}: ${err?.message}`);
      }
    }

    const url = (typeof p.url === 'string' && p.url) || (typeof p.uri === 'string' ? `https://www.protocols.io/view/${p.uri}` : `https://www.protocols.io/view/${idOrSlug}`);

    return {
      id: String(numericId ?? idOrSlug),
      title: String(p.title ?? 'Protocol'),
      url,
      description: typeof p.description === 'string' ? p.description : '',
      steps
    };
  }
}
