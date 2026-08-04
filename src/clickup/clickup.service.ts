import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BacklogCard, BacklogComment, BacklogSeverity } from './clickup.dto';

/**
 * Marker used to attribute app-posted comments. ClickUp's API has NO author
 * override — every comment created with a token appears as that token's owner —
 * so the real author is embedded in the body and parsed back out for display.
 */
const APP_ATTRIBUTION = /^\*\*(.+?) \(via Canvas\)\*\*\s*\n+/;

/**
 * Machine-readable block the n8n triage workflow appends to each card
 * description, carrying a JSON payload.
 *
 *   <!-- canvas-meta
 *   {"sourceBugId":"68f0…","area":"Invoicing","summary":"…"}
 *   -->
 *
 * JSON rather than `key: value` lines, and JSON rather than reading the markdown
 * body, because **ClickUp STRIPS MARKDOWN from `description` on read**: a card
 * written with `### Summary` comes back as a bare `Summary` line, list markers
 * vanish, and there is no `markdown_description` field to read instead. HTML
 * comments do survive verbatim, so this block is the only reliable channel for
 * structured data — and JSON handles multi-line values that a flat key/value
 * block could not.
 */
const META_BLOCK = /<!--\s*canvas-meta\s*([\s\S]*?)-->/i;

/**
 * Headings the triage workflow writes. Used only for cards WITHOUT a meta block
 * (e.g. hand-written in ClickUp) — matched as bare lines, since the leading
 * `###` is stripped by the time we read it back.
 */
const SECTION_HEADINGS = ['Summary', 'Steps to reproduce', 'Expected', 'Actual', 'Proposed fix'];

/** ClickUp priority id → our severity. 1=urgent … 4=low. */
const PRIORITY_TO_SEVERITY: Record<string, BacklogSeverity> = {
  '1': BacklogSeverity.BLOCKER,
  '2': BacklogSeverity.MAJOR,
  '3': BacklogSeverity.MINOR,
  '4': BacklogSeverity.COSMETIC
};

interface CacheEntry {
  at: number;
  cards: BacklogCard[];
}

@Injectable()
export class ClickUpService {
  private readonly logger = new Logger(ClickUpService.name);
  private readonly token?: string;
  private readonly listId?: string;
  private readonly baseUrl: string;
  private readonly cacheSeconds: number;
  private cache: CacheEntry | null = null;

  constructor(private readonly configService: ConfigService) {
    this.token = this.configService.get<string>('clickup.apiToken');
    this.listId = this.configService.get<string>('clickup.bugListId');
    this.baseUrl = (this.configService.get<string>('clickup.apiBaseUrl') || 'https://api.clickup.com/api/v2').replace(/\/$/, '');
    this.cacheSeconds = Number(this.configService.get<number>('clickup.listCacheSeconds') ?? 45);
  }

  isConfigured(): boolean {
    return !!this.token && !!this.listId;
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('The bug backlog is not configured (missing CLICKUP_API_TOKEN or CLICKUP_BUG_LIST_ID).');
    }
  }

  private async call(path: string, init?: RequestInit): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: this.token as string,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(init?.headers ?? {})
        }
      });
    } catch (err: any) {
      this.logger.error(`ClickUp request failed: ${err?.message}`);
      throw new ServiceUnavailableException('Could not reach ClickUp.');
    }
    if (res.status === 429) {
      // ClickUp allows ~100 requests/minute per token.
      throw new ServiceUnavailableException('ClickUp rate limit reached — try again in a moment.');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`ClickUp ${res.status} for ${path}: ${body.slice(0, 300)}`);
      throw new ServiceUnavailableException(`ClickUp error (${res.status}).`);
    }
    return res.json().catch(() => ({}));
  }

  /**
   * Parse the canvas-meta block. Accepts a JSON payload (what the triage workflow
   * writes) and falls back to `key: value` lines so hand-edited cards still work.
   */
  private parseMeta(description: string): Record<string, string> {
    const m = META_BLOCK.exec(description || '');
    if (!m) return {};
    const raw = m[1].trim();
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== null && v !== undefined && v !== '') out[k] = String(v);
        }
        return out;
      } catch {
        this.logger.warn('canvas-meta block is not valid JSON; falling back to line parsing');
      }
    }
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  }

  /**
   * Pull a section out of the plain-text description, for cards with no meta
   * block. Headings are matched as BARE lines (no `###`) because ClickUp strips
   * markdown before we ever see it.
   */
  private section(description: string, heading: string): string | undefined {
    const others = SECTION_HEADINGS.filter((h) => h.toLowerCase() !== heading.toLowerCase())
      .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const re = new RegExp(`^\\s*#{0,3}\\s*${heading}\\s*$\\n([\\s\\S]*?)(?=^\\s*#{0,3}\\s*(?:${others})\\s*$|<!--\\s*canvas-meta|$)`, 'im');
    const m = re.exec(description || '');
    const body = m?.[1]?.replace(/^\s*---\s*$[\s\S]*$/m, '').trim();
    return body ? body : undefined;
  }

  private toCard(task: any): BacklogCard {
    const description: string = task?.description ?? task?.text_content ?? '';
    const meta = this.parseMeta(description);
    const priorityId = task?.priority?.id != null ? String(task.priority.id) : '';
    const occurrences = Number(meta.occurrences);

    return {
      id: String(task?.id ?? ''),
      title: String(task?.name ?? 'Untitled'),
      status: String(task?.status?.status ?? 'unknown'),
      isClosed: String(task?.status?.type ?? '') === 'closed',
      severity: PRIORITY_TO_SEVERITY[priorityId] ?? BacklogSeverity.UNKNOWN,
      area: meta.area || undefined,
      category: meta.category || undefined,
      // Meta block wins: it is the only channel markdown-stripping can't damage.
      // Section parsing is the fallback for cards written by hand in ClickUp.
      summary: meta.summary || this.section(description, 'Summary'),
      stepsToReproduce: meta.stepsToReproduce || this.section(description, 'Steps to reproduce'),
      expected: meta.expected || this.section(description, 'Expected'),
      actual: meta.actual || this.section(description, 'Actual'),
      proposedFix: meta.proposedFix || this.section(description, 'Proposed fix'),
      suggestedOwner: meta.suggestedOwner || undefined,
      assignees: Array.isArray(task?.assignees) ? task.assignees.map((a: any) => String(a?.username ?? a?.email ?? '')).filter(Boolean) : [],
      reporterName: meta.reporterName || undefined,
      reporterEmail: meta.reporterEmail || undefined,
      sessionTag: meta.sessionTag || undefined,
      occurrences: Number.isFinite(occurrences) && occurrences > 0 ? occurrences : 1,
      sourceBugId: meta.sourceBugId || undefined,
      commentCount: Number(task?.comment_count) || 0,
      clickupUrl: task?.url ? String(task.url) : undefined,
      createdAt: task?.date_created ? new Date(Number(task.date_created)).toISOString() : new Date(0).toISOString(),
      updatedAt: task?.date_updated ? new Date(Number(task.date_updated)).toISOString() : undefined
    };
  }

  /**
   * The whole board, closed cards included so the app can show recently-resolved
   * work. Cached briefly to protect the per-token rate limit from concurrent
   * viewers; pass force to bypass (e.g. straight after posting a comment).
   */
  async listBacklog(force = false): Promise<BacklogCard[]> {
    this.assertConfigured();
    if (!force && this.cache && Date.now() - this.cache.at < this.cacheSeconds * 1000) {
      return this.cache.cards;
    }
    const cards: BacklogCard[] = [];
    // ClickUp caps a page at 100 tasks; walk pages until one comes back short.
    for (let page = 0; page < 20; page++) {
      const data = await this.call(`/list/${encodeURIComponent(this.listId as string)}/task?include_closed=true&subtasks=false&page=${page}`);
      const batch = Array.isArray(data?.tasks) ? data.tasks : [];
      cards.push(...batch.map((t: any) => this.toCard(t)));
      if (batch.length < 100) break;
    }
    this.cache = { at: Date.now(), cards };
    return cards;
  }

  async getCard(taskId: string): Promise<BacklogCard> {
    this.assertConfigured();
    const task = await this.call(`/task/${encodeURIComponent(taskId)}`);
    if (!task?.id) throw new BadRequestException('Backlog card not found.');
    return this.toCard(task);
  }

  /** Comments are fetched only when a card is opened, again to spare the rate limit. */
  async getComments(taskId: string): Promise<BacklogComment[]> {
    this.assertConfigured();
    const data = await this.call(`/task/${encodeURIComponent(taskId)}/comment`);
    const raw = Array.isArray(data?.comments) ? data.comments : [];
    return raw
      .map((c: any) => {
        const text: string = typeof c?.comment_text === 'string' ? c.comment_text : '';
        const attributed = APP_ATTRIBUTION.exec(text);
        return {
          id: String(c?.id ?? ''),
          author: attributed ? attributed[1] : String(c?.user?.username ?? c?.user?.email ?? 'Unknown'),
          fromApp: !!attributed,
          text: attributed ? text.replace(APP_ATTRIBUTION, '') : text,
          createdAt: c?.date ? new Date(Number(c.date)).toISOString() : new Date(0).toISOString()
        } as BacklogComment;
      })
      .sort((a: BacklogComment, b: BacklogComment) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Append a comment on behalf of an app user. ClickUp will record the token
   * owner as the author, so the real author is written into the body in a form
   * getComments() can parse back out.
   */
  async addComment(taskId: string, body: string, authorDisplayName: string): Promise<BacklogComment> {
    this.assertConfigured();
    const trimmed = (body ?? '').trim();
    if (!trimmed) throw new BadRequestException('Comment cannot be empty.');
    if (trimmed.length > 10000) throw new BadRequestException('Comment is too long (10000 character limit).');

    const safeAuthor = authorDisplayName.replace(/[\r\n*]/g, ' ').trim() || 'Unknown user';
    // Strip any attribution-shaped prefix the client supplied. The parsed author
    // was already safe (the outer prefix wins), but leaving this in place would
    // render bold text appearing to quote someone else.
    const cleaned = trimmed.replace(/^\s*(?:\*\*.+? \(via Canvas\)\*\*\s*)+/g, '').trim();
    if (!cleaned) throw new BadRequestException('Comment cannot be empty.');
    const comment_text = `**${safeAuthor} (via Canvas)**\n\n${cleaned}`;

    const res = await this.call(`/task/${encodeURIComponent(taskId)}/comment`, {
      method: 'POST',
      body: JSON.stringify({ comment_text, notify_all: false })
    });

    // The card's comment_count changed, so the cached board is stale.
    this.cache = null;

    return {
      id: String(res?.id ?? ''),
      author: safeAuthor,
      fromApp: true,
      text: cleaned,
      createdAt: new Date().toISOString()
    };
  }
}
