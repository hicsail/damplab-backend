#!/usr/bin/env node
/**
 * Replace the local job graph with the contents of jobs-export.json.
 *
 *   node tools/jobs-import.mjs --dry-run      # counts only, changes nothing
 *   node tools/jobs-import.mjs
 *   node tools/jobs-import.mjs --own          # also make every job yours locally
 *
 * Clears the same collections wipe-jobs.mjs does (minus the three it cannot
 * populate — see below), then inserts, preserving _id verbatim so every
 * cross-reference survives: job -> workflows -> nodes/edges, node -> service,
 * sow -> job, sowVersion -> sow, comment/invoice/jobVersion -> job.
 *
 * IMPORT THE CATALOG FIRST (catalog-import.mjs). Workflow nodes reference services
 * by ObjectId; a job export only lines up with a catalog from the same deployment.
 * The integrity report at the end tells you if it did not.
 *
 * --own rewrites every job's `sub` to the local dev identity. Without it, imported
 * jobs belong to staging Keycloak subjects: fine as an administrator (you hold
 * `jobs:view-all`), but a client-tier walkthrough shows an empty dashboard, because
 * `jobsForViewer` scopes to the caller server-side. Pass --own-sub <sub> for a
 * different identity.
 *
 * NEVER POPULATED, because the export cannot read them:
 *   job_review_operations, job_feed_status, notifications.
 * They are cleared, not restored — see tools/README.md.
 */

import { readFileSync } from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';

const URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/damplab';
const FILE = argValue('--in') ?? 'jobs-export.json';
const DRY = process.argv.includes('--dry-run');
const OWN = process.argv.includes('--own') || process.argv.includes('--own-sub');
/** Matches AuthRolesGuard.devUser()'s sub, so ownership-scoped UI works locally. */
const OWN_SUB = argValue('--own-sub') ?? 'dev';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const oid = (v) => (v ? new ObjectId(String(v)) : undefined);
const oids = (a) => (Array.isArray(a) ? a.filter(Boolean).map((v) => new ObjectId(String(v))) : []);
const date = (v) => (v ? new Date(v) : undefined);
/**
 * Coerce every date-shaped key back to a real Date. Enumerating them by hand
 * missed `updatedAt` and `voidedAt`; ISO strings sort and compare wrong against
 * Dates, and the raw driver does no casting.
 */
const DATE_KEY = /(At|_at)$|^date$|^submitted$|Date$/;
const dates = (doc) => {
  for (const [k, v] of Object.entries(doc)) {
    if (DATE_KEY.test(k) && typeof v === 'string') doc[k] = new Date(v);
  }
  return doc;
};
const clean = (doc) => dates(Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined && v !== null)));

const data = JSON.parse(readFileSync(FILE, 'utf8'));
console.log(`Source: ${data.source ?? '?'} @ ${data.exportedAt ?? '?'}`);
if (data.partial) {
  console.log(`\n⚠ This export was taken with --force, without jobs:view-all.\n  It holds only the exporter's own jobs, not the full set.\n`);
}

// ── Flatten the nested export into collections ──────────────────────────────
const jobs = [];
const workflows = [];
const nodes = [];
const edges = [];
const jobVersions = [];
const comments = [];

for (const j of data.jobs ?? []) {
  const jobOid = oid(j.id);
  const jobStr = String(j.id);

  for (const w of j.workflows ?? []) {
    // `workflows` stores no back-reference to its job — see the type table in
    // tools/README.md. Setting one would invent a field the model does not have.
    // Edge _ids are minted here (the schema exposes none) and the workflow's
    // `edges` array is built from those same values, so the pair stays consistent.
    const edgeIds = (w.edges ?? []).map(() => new ObjectId());
    workflows.push(
      clean({ _id: oid(w.id), name: w.name, state: w.state,
              nodes: oids((w.nodes ?? []).map((n) => n._id ?? n.id)),
              edges: edgeIds })
    );
    for (const n of w.nodes ?? []) {
      // Likewise: nodes carry `service` only; `workflow`/`job` are resolver-side.
      nodes.push(
        clean({ ...n, _id: oid(n._id ?? n.id), id: n.id,
                service: oid(n.service?.id),
                usedInventory: oids(n.usedInventory),
                startedAt: date(n.startedAt), archivedAt: date(n.archivedAt),
                inventoryReservationStart: date(n.inventoryReservationStart),
                inventoryReservationEnd: date(n.inventoryReservationEnd),
                workflow: undefined, job: undefined })
      );
    }
    (w.edges ?? []).forEach((e, i) => {
      // `id` is the ReactFlow-side string, not the Mongo _id; source/target are
      // ObjectId refs to workflow nodes.
      edges.push(clean({ _id: edgeIds[i], id: e.id,
                         source: oid(e.source?._id ?? e.source),
                         target: oid(e.target?._id ?? e.target),
                         reactEdge: e.reactEdge }));
    });
  }

  // jobId is a STRING mirror "for querying" (the model says so, and the service
  // queries `find({ jobId })` with a plain string); `job` is the ObjectId ref.
  for (const v of j.versions ?? []) {
    jobVersions.push(clean({ ...v, _id: oid(v.id), id: undefined,
                             jobId: jobStr, job: jobOid,
                             publishedAt: date(v.publishedAt), createdAt: date(v.createdAt) }));
  }
  // Comments are the exception: their jobId really is an ObjectId ref.
  for (const c of j.comments ?? []) {
    comments.push(clean({ ...c, _id: oid(c.id), id: undefined, jobId: jobOid,
                          nodeId: oid(c.nodeId), createdAt: date(c.createdAt), updatedAt: date(c.updatedAt) }));
  }

  jobs.push(
    clean({ ...j, _id: jobOid, id: undefined,
            sub: OWN ? OWN_SUB : j.sub,
            workflows: oids((j.workflows ?? []).map((w) => w.id)),
            versions: undefined, comments: undefined,
            attachments: (j.attachments ?? []).map((a) => clean({ ...a, uploadedAt: date(a.uploadedAt) })),
            submitted: date(j.submitted), acceptedAt: date(j.acceptedAt), archivedAt: date(j.archivedAt) })
  );
}

const plan = [
  { collection: 'jobs', docs: jobs },
  { collection: 'workflows', docs: workflows },
  { collection: 'workflownodes', docs: nodes },
  { collection: 'workflowedges', docs: edges },
  { collection: 'job_versions', docs: jobVersions },
  { collection: 'comments', docs: comments },
  {
    collection: 'sows',
    docs: (data.sows ?? []).map((s) =>
      clean({ ...s, _id: oid(s.id), id: undefined, jobId: String(s.jobId), job: oid(s.jobId),
              date: date(s.date), createdAt: date(s.createdAt), updatedAt: date(s.updatedAt) })
    )
  },
  {
    collection: 'sow_versions',
    docs: (data.sowVersions ?? []).map((v) =>
      clean({ ...v, _id: oid(v.id), id: undefined, sowId: String(v.sowId), sow: oid(v.sowId),
              sentToCustomerAt: date(v.sentToCustomerAt), createdAt: date(v.createdAt) })
    )
  },
  {
    collection: 'invoices',
    docs: (data.invoices ?? []).map((i) =>
      clean({ ...i, _id: oid(i.id), id: undefined, jobId: String(i.jobId), job: oid(i.jobId),
              invoiceDate: date(i.invoiceDate), createdAt: date(i.createdAt) })
    )
  },
  {
    collection: 'activity_events',
    docs: (data.activityEvents ?? []).map((a) =>
      // activity_events keeps jobId as a plain string too.
      clean({ ...a, _id: oid(a.id), id: undefined, jobId: a.jobId ? String(a.jobId) : undefined, createdAt: date(a.createdAt) })
    )
  }
];

/** Cleared but never repopulated — the schema exposes no way to read them. */
const CLEARED_ONLY = ['job_review_operations', 'job_feed_status', 'notifications', 'usagesows', 'usageinvoices'];

// ── Apply ───────────────────────────────────────────────────────────────────
const client = new MongoClient(URI);
await client.connect();
const db = client.db();

console.log(`${DRY ? 'DRY RUN — ' : ''}target ${URI}`);
if (OWN && !DRY) console.log(`--own: every job's sub rewritten to "${OWN_SUB}"`);
console.log('\ncollection                 before   incoming');
console.log('─'.repeat(48));

for (const { collection, docs } of plan) {
  const before = await db.collection(collection).countDocuments();
  console.log(`${collection.padEnd(24)}${String(before).padStart(7)}${String(docs.length).padStart(11)}`);
  if (DRY) continue;
  await db.collection(collection).deleteMany({});
  if (docs.length) await db.collection(collection).insertMany(docs, { ordered: false });
}

console.log('\ncleared but NOT repopulated (no read API):');
for (const name of CLEARED_ONLY) {
  const before = await db.collection(name).countDocuments();
  console.log(`  ${name.padEnd(24)}${String(before).padStart(7)} -> 0`);
  if (!DRY && before) await db.collection(name).deleteMany({});
}

// ── Referential integrity ───────────────────────────────────────────────────
if (!DRY) {
  const serviceIds = new Set((await db.collection('damplabservices').find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
  const jobIds = new Set((await db.collection('jobs').find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));

  const orphanNodes = (await db.collection('workflownodes').find({}).toArray())
    .filter((n) => n.service && !serviceIds.has(String(n.service)));
  const orphanSows = (await db.collection('sows').find({}).toArray())
    .filter((s) => s.jobId && !jobIds.has(String(s.jobId)));
  const orphanVersions = (await db.collection('job_versions').find({}).toArray())
    .filter((v) => v.jobId && !jobIds.has(String(v.jobId)));

  console.log('');
  if (orphanNodes.length) {
    console.log(`⚠ ${orphanNodes.length} workflow node(s) reference a service that is not in the local catalog.`);
    console.log(`  Run catalog-import.mjs with a catalog exported from the SAME deployment.`);
  } else {
    console.log('✓ Every workflow node resolves to a local service.');
  }
  if (orphanSows.length) console.log(`⚠ ${orphanSows.length} SOW(s) reference a missing job.`);
  if (orphanVersions.length) console.log(`⚠ ${orphanVersions.length} job version(s) reference a missing job.`);

  if (!OWN) {
    const subs = new Set((await db.collection('jobs').find({}, { projection: { sub: 1 } }).toArray()).map((d) => d.sub).filter(Boolean));
    console.log(`\nJobs belong to ${subs.size} staging subject(s). As an administrator you will see them all;`);
    console.log(`re-run with --own to make them yours so client-tier walkthroughs work.`);
  }
}

await client.close();
console.log(`\n${DRY ? '✓ Dry run complete — nothing written.' : '✓ Job graph replaced.'}\n`);
