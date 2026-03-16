import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ProtocolsIoProtocolMetadata {
  id: string;
  title: string;
  url: string;
  version?: string;
  description?: string;
}

interface ProtocolsIoConfig {
  clientAccessToken?: string;
  baseUrl?: string;
}

@Injectable()
export class ProtocolsIoService {
  private readonly logger = new Logger(ProtocolsIoService.name);
  private readonly baseUrl: string;
  private readonly clientAccessToken?: string;

  constructor(private readonly configService: ConfigService) {
    const cfg = this.configService.get<ProtocolsIoConfig>('protocolsIo');
    this.baseUrl = (cfg?.baseUrl || 'https://www.protocols.io/api/v3').replace(/\/$/, '');
    this.clientAccessToken = cfg?.clientAccessToken;
  }

  /** True if a client access token is configured. */
  isConfigured(): boolean {
    return Boolean(this.clientAccessToken);
  }

  private async fetchJson(path: string): Promise<any | null> {
    if (!this.clientAccessToken) {
      this.logger.warn('Protocols.io client access token is not configured; skipping external API call.');
      return null;
    }
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.clientAccessToken}`,
        Accept: 'application/json'
      }
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Protocols.io request failed: ${res.status} ${text}`);
      return null;
    }
    try {
      return await res.json();
    } catch (err) {
      this.logger.warn(`Protocols.io JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Fetch a protocol by ID from protocols.io and normalize its metadata.
   * Returns null if the protocol is not found or the API is not configured/reachable.
   */
  async getProtocolById(protocolId: string): Promise<ProtocolsIoProtocolMetadata | null> {
    if (!protocolId) return null;
    const trimmed = String(protocolId).trim();
    if (!trimmed) return null;

    const data = await this.fetchJson(`/protocols/${encodeURIComponent(trimmed)}`);
    if (!data) return null;

    // The exact response shape may evolve; use defensive access.
    // https://apidoc.protocols.io/ describes top-level fields like id, title, uri, etc.
    const raw = data.protocol || data;
    const id = String(raw.id ?? trimmed);
    const title: string = raw.title ?? raw.name ?? `Protocol ${id}`;
    const url: string = raw.uri ?? raw.url ?? raw.link ?? '';
    const version: string | undefined = raw.version ?? raw.version_id ?? undefined;
    const description: string | undefined =
      raw.description ??
      raw.short_description ??
      (Array.isArray(raw.steps) ? raw.steps.map((s: any) => s.name || s.title).filter(Boolean).join('; ') : undefined);

    return {
      id,
      title,
      url,
      version,
      description
    };
  }
}

