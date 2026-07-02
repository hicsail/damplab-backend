import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DampLabServices } from '../services/damplab-services.services';

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

/** Lean catalog entry handed to the agent (it only needs to pick services + set params). */
interface CatalogEntry {
  id: string;
  name: string;
  description?: string;
  parameters: Array<{ id: string; name: string; type: string; required?: boolean; options?: string[] }>;
  allowedConnections: string[];
}

export interface AgentResult {
  type: 'question' | 'workflow';
  message: string;
  workflow: {
    nodes: Array<{ serviceId: string; serviceName?: string; parameters?: Record<string, unknown> }>;
    edges: Array<{ from: number; to: number }>;
  };
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly dampLabServices: DampLabServices,
    private readonly configService: ConfigService
  ) {}

  /**
   * Build a compact catalog of active services for the agent. We deliberately
   * strip pricing/icons/etc — the agent only needs ids, names, descriptions,
   * parameter shapes, and connection rules. The client re-hydrates full node
   * data from its own catalog, so the agent can't inject anything else.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async buildCatalog(): Promise<CatalogEntry[]> {
    const services = await this.dampLabServices.findAll();
    return services.map((s: any) => {
      const parameters = Array.isArray(s.parameters)
        ? s.parameters
            .filter((p: any) => p && (p.paramType ?? 'input') !== 'result')
            .map((p: any) => ({
              id: String(p.id ?? ''),
              name: String(p.name ?? p.id ?? ''),
              type: String(p.type ?? 'string'),
              required: !!p.required,
              options: Array.isArray(p.options)
                ? p.options.map((o: any) => (o && o.name ? String(o.name) : String(o))).filter(Boolean)
                : undefined
            }))
        : [];
      const allowedConnections = Array.isArray(s.allowedConnections)
        ? s.allowedConnections.map((c: any) => String(c?.id ?? c?._id ?? c)).filter(Boolean)
        : [];
      return {
        id: String(s.id ?? s._id),
        name: String(s.name ?? ''),
        description: s.description ? String(s.description) : undefined,
        parameters,
        allowedConnections
      };
    });
  }

  /**
   * Forward the conversation to an n8n agent webhook and return the normalized
   * result. n8n returns a single JSON response; the controller streams it.
   *
   * agentKey selects the webhook + whether to inject the service catalog:
   *  - 'canvas'      → workflow builder, catalog injected
   *  - 'lab-status'  → reads Mongo directly via n8n, no catalog
   */
  async runAgent(
    agentKey: 'canvas' | 'lab-status',
    message: string,
    history: ChatHistoryEntry[],
    csv?: { filename?: string; content: string } | null
  ): Promise<AgentResult> {
    const webhookUrl =
      agentKey === 'lab-status'
        ? this.configService.get<string>('agent.labStatusWebhookUrl')
        : this.configService.get<string>('agent.webhookUrl');
    if (!webhookUrl) {
      throw new ServiceUnavailableException(`Agent "${agentKey}" is not configured (missing webhook URL).`);
    }
    const secret = this.configService.get<string>('agent.webhookSecret');

    // Both agents now read what they need from Mongo via n8n tools, so we no
    // longer inject the service catalog. (buildCatalog is kept for reference /
    // possible reuse but intentionally unused.)
    const payload: Record<string, unknown> = { message, history: history ?? [] };
    // Forward an attached CSV (lab-ops agent uses it to propose service creation).
    if (csv && typeof csv.content === 'string' && csv.content.trim()) {
      payload.csv = { filename: csv.filename || 'upload.csv', content: csv.content.slice(0, 200000) };
    }

    let res: Response;
    try {
      res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'x-agent-secret': secret } : {})
        },
        body: JSON.stringify(payload)
      });
    } catch (err: any) {
      this.logger.error(`Agent "${agentKey}" webhook call failed: ${err?.message}`);
      throw new ServiceUnavailableException(`Could not reach the ${agentKey} agent.`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Agent "${agentKey}" webhook returned ${res.status}: ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException(`${agentKey} agent error (${res.status}).`);
    }

    const data = (await res.json().catch(() => null)) as Partial<AgentResult> | null;
    return this.normalize(data);
  }

  private normalize(data: Partial<AgentResult> | null): AgentResult {
    const type = data?.type === 'workflow' ? 'workflow' : 'question';
    const message = String(
      data?.message || (type === 'question' ? 'Could you tell me more about what you want to do?' : 'Here is a suggested workflow.')
    );
    const wf = data?.workflow && typeof data.workflow === 'object' ? data.workflow : { nodes: [], edges: [] };
    return {
      type,
      message,
      workflow: {
        nodes: Array.isArray(wf.nodes) ? wf.nodes : [],
        edges: Array.isArray(wf.edges) ? wf.edges : []
      }
    };
  }
}
