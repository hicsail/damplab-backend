import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { AgentService, ChatHistoryEntry } from './agent.service';

interface ChatRequestBody {
  message?: string;
  history?: ChatHistoryEntry[];
  csv?: { filename?: string; content: string } | null;
}

@Controller('api/agent')
@UseGuards(AuthRolesGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  /**
   * Chat endpoint for the canvas agent. Any authenticated user may use it
   * (no @Roles — the guard just enforces a valid Keycloak token). That is
   * deliberate: this agent is the assistant on the client-facing canvas, so
   * requiring staff here would remove a feature customers have today. Narrowing
   * it, if wanted, belongs with the rest of the customer-facing narrowing.
   * Responds as
   * Server-Sent Events:
   *   data: {"delta":"..."}          // streamed message text
   *   data: {"done":true,"type":..,"message":..,"workflow":{...}}
   *   data: [DONE]
   *
   * n8n returns the whole result at once; we chunk the message text server-side
   * for a streaming feel and emit the structured workflow in the final event.
   * (Token-level streaming would require n8n response streaming — a later step.)
   */
  /** Canvas workflow-builder agent (catalog injected). */
  @Post('chat')
  async chat(@Body() body: ChatRequestBody, @Res() res: Response): Promise<void> {
    return this.streamAgent('canvas', body, res);
  }

  /**
   * Lab-status agent (queries Mongo via n8n).
   *
   * The class-level guard only requires a valid token, so before this decoration
   * every authenticated user — including any customer — could drive this proxy.
   *
   * `labassistant:use` rather than the `damplab-staff` role it replaces: the matrix
   * amendment grants the AI Lab Assistant to technicians, and this endpoint is the
   * only backend surface of `/lab-assistant`. Gating on the role would have left
   * technicians with the button and a 403.
   *
   * `POST /chat` above stays open — deferred decision #2 in the 2b checklist,
   * answered there: narrowing it would remove a customer feature.
   */
  @RequirePermission(Permission.LabAssistantUse)
  @Post('lab-status/chat')
  async labStatusChat(@Body() body: ChatRequestBody, @Res() res: Response): Promise<void> {
    return this.streamAgent('lab-status', body, res);
  }

  /** Shared SSE pipe: run the agent, stream the message text, end with the
   *  structured done event (carries workflow for the canvas agent; empty for others). */
  private async streamAgent(agentKey: 'canvas' | 'lab-status', body: ChatRequestBody, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx)
    res.flushHeaders?.();

    const send = (obj: unknown): void => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    try {
      const message = String(body?.message ?? '').trim();
      if (!message) {
        send({ done: true, type: 'question', message: 'Please type your message.', workflow: { nodes: [], edges: [] } });
        send('[DONE]');
        res.end();
        return;
      }

      const result = await this.agentService.runAgent(agentKey, message, body?.history ?? [], body?.csv ?? null);

      // Stream the message text in small word-group chunks for a live feel.
      const words = result.message.split(/(\s+)/);
      const chunkSize = 4;
      for (let i = 0; i < words.length; i += chunkSize) {
        send({ delta: words.slice(i, i + chunkSize).join('') });
        await new Promise((r) => setTimeout(r, 25));
      }

      send({ done: true, type: result.type, message: result.message, workflow: result.workflow });
      send('[DONE]');
      res.end();
    } catch (err: any) {
      // The guard already ran; errors here are agent/n8n failures.
      send({ done: true, type: 'question', message: `Sorry — the assistant is unavailable right now (${err?.message ?? 'error'}).`, workflow: { nodes: [], edges: [] } });
      send('[DONE]');
      res.end();
    }
  }
}
