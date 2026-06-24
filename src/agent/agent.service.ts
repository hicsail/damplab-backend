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
   * Forward the conversation + catalog to the n8n agent webhook and return the
   * normalized result. n8n returns a single JSON response; the controller is
   * responsible for streaming it to the client.
   */
  async runAgent(message: string, history: ChatHistoryEntry[]): Promise<AgentResult> {
    const webhookUrl = this.configService.get<string>('agent.webhookUrl');
    if (!webhookUrl) {
      throw new ServiceUnavailableException('Canvas agent is not configured (N8N_AGENT_WEBHOOK_URL missing).');
    }
    const secret = this.configService.get<string>('agent.webhookSecret');
    const catalog = await this.buildCatalog();

    let res: Response;
    try {
      res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'x-agent-secret': secret } : {})
        },
        body: JSON.stringify({ message, history: history ?? [], catalog })
      });
    } catch (err: any) {
      this.logger.error(`Agent webhook call failed: ${err?.message}`);
      throw new ServiceUnavailableException('Could not reach the canvas agent.');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Agent webhook returned ${res.status}: ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException(`Canvas agent error (${res.status}).`);
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
