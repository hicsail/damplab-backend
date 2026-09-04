#!/usr/bin/env node
/**
 * Delete every local job and everything hanging off it.
 *
 *   node tools/wipe-jobs.mjs --dry-run
 *   node tools/wipe-jobs.mjs
 *
 * There is no deleteJob mutation in the schema — job deletion was never an exposed
 * operation — so this goes straight at Mongo.
 *
 * Deleting `jobs` alone would leave orphans: workflows, SOW documents and their
 * version history, comments, invoices and the per-operation review rows all key off
 * a job id and would survive as unreachable garbage that still shows up in staff
 * queries. The collections below are the ones whose models carry a job reference.
 *
 * Deliberately NOT touched: the catalog (that is catalog-import.mjs), announcements,
 * training resources, api keys, stations, bookings, and the `guides` / `sequences` /
 * `screening*` collections, which have no model in the current tree.
 */

import { MongoClient } from 'mongodb';
import 'dotenv/config';

// Reads damplab-backend/.env, so this follows whatever MONGO_URI the rest of
// the backend uses rather than hardcoding a host port.
const URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/damplab';
const DRY = process.argv.includes('--dry-run');

/** Every collection whose model references a job (directly, or via a SOW that does). */
const COLLECTIONS = [
  'jobs',
  'workflows',
  'workflownodes',
  'workflowedges',
  'job_versions',
  'job_review_operations',
  'job_feed_status',
  'sows',
  'sow_versions',
  'comments',
  'invoices',
  'usagesows',
  'usageinvoices',
  // jobId is optional on these two — a local dev DB has no non-job rows worth
  // keeping, and leaving them makes the activity feed reference deleted jobs.
  'activity_events',
  'notifications'
];

const client = new MongoClient(URI);
await client.connect();
const db = client.db();

console.log(`${DRY ? 'DRY RUN — ' : ''}target ${URI}\n`);
console.log('collection                 count');
console.log('─'.repeat(38));

let total = 0;
for (const name of COLLECTIONS) {
  const n = await db.collection(name).countDocuments();
  total += n;
  console.log(`${name.padEnd(26)}${String(n).padStart(7)}`);
  if (!DRY && n) await db.collection(name).deleteMany({});
}

console.log('─'.repeat(38));
console.log(`${'total'.padEnd(26)}${String(total).padStart(7)}`);

if (!DRY) {
  const left = [];
  for (const name of COLLECTIONS) {
    const n = await db.collection(name).countDocuments();
    if (n) left.push(`${name}=${n}`);
  }
  console.log(left.length ? `\n⚠ still populated: ${left.join(', ')}` : `\n✓ Deleted ${total} documents across ${COLLECTIONS.length} collections.`);
}

await client.close();
console.log();
