/**
 * Standalone Aclid sequence-screening script.
 *
 * Authenticates against the Aclid API and runs a single, synchronous DNA
 * sequence screen, then prints the resulting risk/regulatory summary.
 *
 * It is intentionally self-contained: no imports from the NestJS app, no extra
 * dependencies (uses the built-in global `fetch`, Node 18+). It reads
 * credentials from the environment, falling back to the repo-root `.env`.
 *
 * Usage:
 *   npx ts-node --transpile-only aclid-screen.ts
 *   npx ts-node --transpile-only aclid-screen.ts "MySeqName" ATGAGC...   # custom
 *   npx ts-node --transpile-only aclid-screen.ts --file path/to/seq.txt  # from file
 *
 * Env (see .env):
 *   ACLID_API_URL   e.g. https://api.aclid.bio
 *   ACLID_API_KEY   your Aclid API key (sent as the Authorization header)
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const fetchFn: (input: string, init?: unknown) => Promise<any> = (globalThis as any).fetch;

/** A benign default sequence (>= 30 bp, the Aclid minimum) used when none is given. */
const DEFAULT_SEQUENCE =
  'ATGAGCAACACCTGCGACGAGAAGACCCAGAGCCTGGGCGTGAAGTTCCTGGACGAGTACCAGAGCAAGGTGAAGCGGCAGTACTTCAG';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'deleted', 'archived']);
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

interface ReportMetadata {
  id: string;
  name?: string | null;
  status: string;
  length?: number | null;
  match_count?: number | null;
  regulatory_status?: string | null;
  findings?: Record<string, unknown> | null;
  material_summary?: Record<string, unknown> | null;
  material_count?: number | null;
  created?: number;
  updated?: number | null;
  [key: string]: unknown;
}

/** Minimal `.env` loader so the script works standalone without dotenv. */
function loadDotEnv(): void {
  try {
    const raw = readFileSync(join(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env file — rely on the ambient environment.
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required environment variable: ${name} (set it in .env or the shell).`);
    process.exit(1);
  }
  return value;
}

function parseArgs(): { name: string; sequence: string } {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1) {
    const path = args[fileIdx + 1];
    if (!path) {
      console.error('--file requires a path.');
      process.exit(1);
    }
    const contents = readFileSync(path, 'utf8');
    // Support a raw sequence or a single-record FASTA.
    const lines = contents.split('\n').filter((l) => l.trim() && !l.startsWith('>'));
    return { name: path.split('/').pop() || 'sequence', sequence: lines.join('').replace(/\s+/g, '') };
  }
  const positional = args.filter((a) => !a.startsWith('--'));
  const name = positional[0] || 'aclid-screen-test';
  const sequence = (positional[1] || DEFAULT_SEQUENCE).replace(/\s+/g, '').toUpperCase();
  return { name, sequence };
}

async function requestJson(url: string, apiKey: string, init?: { method?: string; body?: string }): Promise<any> {
  const res = await fetchFn(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: apiKey,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: init?.body,
    redirect: 'follow'
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // leave as raw text
  }
  if (!res.ok) {
    console.error(`Aclid API error ${res.status} ${res.statusText} for ${url}`);
    console.error(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));
    process.exit(1);
  }
  return parsed;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function printSummary(report: ReportMetadata): void {
  console.log('\n=== Aclid screen summary ===');
  console.log(`  id:                ${report.id}`);
  console.log(`  name:              ${report.name ?? '(none)'}`);
  console.log(`  status:            ${report.status}`);
  console.log(`  regulatory_status: ${report.regulatory_status ?? '(pending)'}`);
  console.log(`  total length:      ${report.length ?? 'n/a'} bp`);
  console.log(`  match_count:       ${report.match_count ?? 0}`);
  console.log(`  material_count:    ${report.material_count ?? 0}`);
  const findings = report.findings && Object.keys(report.findings).length ? report.findings : null;
  console.log(`  findings:          ${findings ? JSON.stringify(findings) : 'none'}`);
  console.log(`  dashboard:         https://dash.aclid.bio/screens/${report.id}`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const baseUrl = requireEnv('ACLID_API_URL').replace(/\/+$/, '');
  const apiKey = requireEnv('ACLID_API_KEY');
  const { name, sequence } = parseArgs();

  if (sequence.length < 30) {
    console.error(`Sequence too short (${sequence.length} bp); Aclid requires at least 30 bp.`);
    process.exit(1);
  }

  console.log(`Submitting screen "${name}" (${sequence.length} bp) to ${baseUrl}/v2/screen_inline ...`);
  const submitted = await requestJson(`${baseUrl}/v2/screen_inline`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      name,
      asynchronous: false,
      sequences: [{ name, sequence }]
    })
  });

  const report: ReportMetadata | undefined = submitted?.items?.[0] ?? submitted;
  if (!report?.id) {
    console.error('Unexpected response from Aclid (no screen id):');
    console.error(JSON.stringify(submitted, null, 2));
    process.exit(1);
  }

  // Fetch the canonical summary — it enriches fields (regulatory_status,
  // material_summary) that the inline submission response leaves unset.
  let current: ReportMetadata = await requestJson(`${baseUrl}/v2/screens/${report.id}`, apiKey);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (!TERMINAL_STATUSES.has(current.status) && Date.now() < deadline) {
    process.stdout.write(`  status: ${current.status} — polling...\n`);
    await sleep(POLL_INTERVAL_MS);
    current = await requestJson(`${baseUrl}/v2/screens/${current.id}`, apiKey);
  }

  printSummary(current);

  if (current.status !== 'succeeded') {
    console.error(`\nScreen did not succeed (status: ${current.status}).`);
    process.exit(2);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
