import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthRolesGuard } from '../auth/auth.guard';
import { AgentService, ChatHistoryEntry } from './agent.service';

interface ChatRequestBody {
  message?: string;
  history?: ChatHistoryEntry[];
}

@Controller('api/agent')
@UseGuards(AuthRolesGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  /**
   * Chat endpoint for the canvas agent. Any authenticated user may use it
   * (no @Roles — the guard just enforces a valid Keycloak token). Responds as
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

  /** Lab-status agent (queries Mongo via n8n; staff-facing). */
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

      const result = await this.agentService.runAgent(agentKey, message, body?.history ?? []);

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
