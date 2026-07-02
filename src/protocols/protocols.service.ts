import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
          .map((st: any) => ({
            id: String(st?.guid ?? st?.id ?? ''),
            number: String(st?.number ?? ''),
            html: typeof st?.step === 'string' ? st.step : ''
          }))
          .filter((s: ProtocolStep) => s.id && s.html);
      } catch (err: any) {
        // Steps are best-effort: still return metadata + the deep link if steps fail.
        this.logger.warn(`protocols.io steps fetch failed for ${numericId}: ${err?.message}`);
      }
    }

    const url =
      (typeof p.url === 'string' && p.url) ||
      (typeof p.uri === 'string' ? `https://www.protocols.io/view/${p.uri}` : `https://www.protocols.io/view/${idOrSlug}`);

    return {
      id: String(numericId ?? idOrSlug),
      title: String(p.title ?? 'Protocol'),
      url,
      description: typeof p.description === 'string' ? p.description : '',
      steps
    };
  }
}
