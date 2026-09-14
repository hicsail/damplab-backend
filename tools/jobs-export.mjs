#!/usr/bin/env node
/**
 * Pull the job graph out of a remote deployment (staging) over GraphQL — the
 * companion to catalog-export.mjs, covering what wipe-jobs.mjs deletes.
 *
 *   STAGING_TOKEN='eyJ...' node tools/jobs-export.mjs
 *
 * Writes ./jobs-export.json (override with --out).
 *
 * IMPORT THE CATALOG FIRST. Jobs reference services by ObjectId (every workflow
 * node carries a service id). catalog-import.mjs preserves those ids verbatim, so
 * a catalog and a job export taken from the SAME deployment line up exactly. Jobs
 * imported against a different catalog will have nodes pointing at services that
 * do not exist locally.
 *
 * THIS EXPORT CONTAINS REAL CUSTOMER PII — `sub`, `email`, `clientEmail`,
 * `clientDisplayName`, `institute`, signature names, and free-text notes that may
 * describe real research. The output file is unencrypted. Treat it accordingly and
 * do not commit it; the backend .gitignore excludes /*-export.json.
 *
 * NOT EXPORTED, because the schema exposes no way to read them (see README):
 *   - job_review_operations   no resolver at all
 *   - job_feed_status         no resolver at all
 *   - notifications           only `myNotifications`, scoped to the caller
 *   - S3 attachment BODIES    only presigned per-request URLs; metadata comes over
 */

const ENDPOINT = process.env.STAGING_URL ?? 'https://damplab-backend.sail.codes/graphql';
const TOKEN = process.env.STAGING_TOKEN ?? argValue('--token');
const OUT = argValue('--out') ?? 'jobs-export.json';
const ACTIVITY_LIMIT = Number(argValue('--activity-limit') ?? 5000);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

if (!TOKEN) {
  console.error(`
Missing token.

  STAGING_TOKEN='eyJ...' node tools/jobs-export.mjs

Get one from a logged-in tab on the staging webapp:
  DevTools -> Network -> any /graphql request -> Request Headers -> Authorization,
  copy everything after "Bearer ".
`);
  process.exit(1);
}

async function gql(query, label, variables) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ query, variables })
    });
  } catch (err) {
    fail(`Could not reach ${ENDPOINT} while fetching ${label}: ${err.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    fail(`${res.status} on ${label}. Token expired or lacks access — grab a fresh one.`);
  }
  const body = await res.json().catch(() => fail(`${label}: response was not JSON (HTTP ${res.status})`));
  if (body.errors?.length) {
    const messages = body.errors.map((e) => e.message);
    if (messages.some((m) => /jwt|token|expired|unauthorized|forbidden/i.test(m))) {
      fail(`${label}: token rejected — "${messages[0]}"\n  Access tokens live only a few minutes. Grab a fresh one and re-run.`);
    }
    fail(`${label} failed:\n  ` + messages.join('\n  '));
  }
  return body.data;
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

/** Bounded concurrency — the per-job/per-SOW fan-outs below are many small calls. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const NODE_FIELDS = `
  _id id label additionalInstructions formData reactNode state price
  service { id }
  assigneeId assigneeDisplayName estimatedMinutes startedAt
  usedInventory completedSteps inventoryReservationStart inventoryReservationEnd
  isArchived archivedAt archivedBy archivedFromState
`;

const JOB_QUERY = `{
  jobs {
    id jobId name username clientDisplayName clientEmail sub email institute
    customerCategory submitted notes state customerActionRequired
    handoverVersionNumber acceptedJobVersionNumber acceptedBillingFingerprint
    acceptedAt acceptedBy isArchived archivedAt archivedBy archivedFromState
    latestContentVersionNumber
    attachments { filename key contentType size uploadedAt }
    workflows {
      id name state
      nodes { ${NODE_FIELDS} }
      # WorkflowEdge exposes no _id — only the ReactFlow-side `id` string — so edge
      # _ids cannot round-trip. jobs-import.mjs mints fresh ones and rebuilds
      # workflows.edges from them; nothing else references an edge by _id.
      edges { id source { _id } target { _id } reactEdge }
    }
    versions {
      id jobId versionNumber authorRole workflows jobState isEvent visibleToCustomer
      publishedAt publishedBy operationId note createdBy createdByName createdAt
    }
    comments {
      id jobId nodeId content author authorType createdAt updatedAt isInternal operationId
      attachments { filename key contentType size uploadedAt }
    }
  }
}`;

const SOW_QUERY = `{
  allSOWs {
    id sowNumber date jobId jobName sowTitle
    clientName clientEmail clientInstitution clientAddress
    scopeOfWork deliverables services timeline resources pricing terms additionalInformation
    createdAt updatedAt createdBy status clientSignature technicianSignature
    currentVersionNumber activeVersionNumber
  }
}`;

const SOW_VERSIONS_QUERY = `query($sowId: ID!) {
  sowVersions(sowId: $sowId) {
    id sowId versionNumber fields inputs status visibleToCustomer
    sourceJobVersionNumber sentToCustomerAt clientSignature staffSignature
    note isDiscarded createdBy createdByName createdAt
  }
}`;

const INVOICES_QUERY = `query($jobId: ID!) {
  invoicesByJobId(jobId: $jobId) {
    id jobId jobDisplayId jobName invoiceNumber invoiceDate createdBy
    services subtotal adjustments totalCost
    billedToName billedToEmail billedToAddress customerCategory createdAt
  }
}`;

// ── Precheck ────────────────────────────────────────────────────────────────
const me = await gql(`{ myPermissions { effective roles } }`, 'myPermissions');
const perms = me.myPermissions.effective ?? [];
const roles = me.myPermissions.roles ?? [];
console.log(`Authenticated as roles: ${roles.join(', ') || '(none)'}`);

if (!perms.includes('jobs:view-all') && !process.argv.includes('--force')) {
  fail(
    `Your token lacks jobs:view-all.\n` +
      `  The server would silently scope every query to your own jobs, producing an\n` +
      `  export that looks complete but holds a fraction of the data. Use an\n` +
      `  administrator account, or --force to accept a partial export.`
  );
}
const partial = !perms.includes('jobs:view-all');
if (partial) console.warn(`\n⚠  --force: proceeding without jobs:view-all. Expect only your own jobs.\n`);

// ── Fetch ───────────────────────────────────────────────────────────────────
const data = {};

const jobsData = await gql(JOB_QUERY, 'jobs');
data.jobs = jobsData.jobs ?? [];
const nodeCount = data.jobs.reduce((n, j) => n + (j.workflows ?? []).reduce((m, w) => m + (w.nodes?.length ?? 0), 0), 0);
console.log(`  jobs            ${data.jobs.length}  (workflows ${data.jobs.reduce((n, j) => n + (j.workflows?.length ?? 0), 0)}, nodes ${nodeCount})`);
console.log(`  jobVersions     ${data.jobs.reduce((n, j) => n + (j.versions?.length ?? 0), 0)}`);
console.log(`  comments        ${data.jobs.reduce((n, j) => n + (j.comments?.length ?? 0), 0)}`);

const sowData = await gql(SOW_QUERY, 'allSOWs');
data.sows = sowData.allSOWs ?? [];
console.log(`  sows            ${data.sows.length}`);

const versionsPerSow = await mapLimit(data.sows, 6, async (s) => {
  const r = await gql(SOW_VERSIONS_QUERY, `sowVersions(${s.id})`, { sowId: s.id });
  return r.sowVersions ?? [];
});
data.sowVersions = versionsPerSow.flat();
console.log(`  sowVersions     ${data.sowVersions.length}`);

const invoicesPerJob = await mapLimit(data.jobs, 6, async (j) => {
  const r = await gql(INVOICES_QUERY, `invoicesByJobId(${j.id})`, { jobId: j.id });
  return r.invoicesByJobId ?? [];
});
data.invoices = invoicesPerJob.flat();
console.log(`  invoices        ${data.invoices.length}`);

const act = await gql(
  `{ activityEvents(limit: ${ACTIVITY_LIMIT}) { id createdAt type message actorDisplayName jobId sowId sowVersionNumber workflowId workflowNodeId serviceName } }`,
  'activityEvents'
);
data.activityEvents = act.activityEvents ?? [];
console.log(`  activityEvents  ${data.activityEvents.length}${data.activityEvents.length === ACTIVITY_LIMIT ? '  ⚠ hit --activity-limit, may be truncated' : ''}`);

// ── Write ───────────────────────────────────────────────────────────────────
const { writeFileSync } = await import('node:fs');
writeFileSync(
  OUT,
  JSON.stringify(
    { exportedAt: new Date().toISOString(), source: ENDPOINT, partial, exportedByRoles: roles, ...data },
    null,
    2
  )
);
console.log(`\n✓ Wrote ${OUT}`);
console.log(`  Contains customer PII — do not commit or share.\n`);
