import mongoose from 'mongoose';

/**
 * **Dev only.** Seeds one local database with every shape the two pre-deploy
 * audits sort into a bucket, so their output can be read against known input.
 *
 * Why this exists: the audits answer "what does *your* data contain", and that
 * question can only be answered by running them against the database you care
 * about. This script answers the other, smaller question — "what does each bucket
 * actually mean, and what would the gate do to a SOW in that state" — without
 * anyone having to touch production to find out.
 *
 * **It cannot substitute for a real run.** Seeded data proves the scripts work
 * and shows what each verdict looks like; it says nothing about which shapes your
 * own database holds.
 *
 * Writes to `damplab_audit_fixtures`, never to the app database, and refuses to
 * run against anything but a local Mongo. Both guards matter: this inserts and
 * drops collections, and pointing it at a real deployment is precisely the
 * accident it must not permit.
 */

/** The database this script is allowed to create. Never the app's own. */
const FIXTURE_DB = 'damplab_audit_fixtures';

/** Hosts a local Mongo can legitimately be on. Anything else is refused. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'mongo', 'backend-db']);

/**
 * Parsed by hand rather than with `new URL`, because a Mongo connection string is
 * not always a valid URL: a replica-set seed list (`mongodb://a:27017,b:27017/db`)
 * throws there. Rejecting a legitimate local seed list with "not a URL" would be a
 * confusing failure, and — worse — tempting to work around.
 */
export function assertLocalUri(uri: string): void {
  const match = /^(mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri.trim());
  if (!match) {
    throw new Error(`MONGO_URI is not a Mongo connection string: ${uri}`);
  }
  const [, scheme, hostSection] = match;
  if (scheme === 'mongodb+srv') {
    throw new Error('Refusing to run: mongodb+srv points at a hosted cluster. This script is for a local Mongo only.');
  }
  // A seed list may carry several hosts; every one of them has to be local.
  const hosts = hostSection
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry.startsWith('[') ? entry.slice(1, entry.indexOf(']')) : entry.split(':')[0]));
  const remote = hosts.filter((host) => !LOCAL_HOSTS.has(host));
  if (remote.length > 0) {
    throw new Error(`Refusing to run against non-local Mongo host(s): ${remote.join(', ')}. This script writes and drops collections and is for local use only.`);
  }
}

/**
 * The same connection string, pointed at the fixture database.
 *
 * String surgery on the path segment, for the same reason `assertLocalUri` parses
 * by hand — and it preserves any query string, which carries options like
 * `?replicaSet=` that the connection needs.
 */
export function fixtureUriFrom(uri: string): string {
  const match = /^(mongodb:\/\/(?:[^@/]*@)?[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri.trim());
  if (!match) throw new Error(`MONGO_URI is not a Mongo connection string: ${uri}`);
  const [, prefix, query] = match;
  return `${prefix}/${FIXTURE_DB}${query ?? ''}`;
}

const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

interface Seeded {
  sows: any[];
  versions: any[];
  invoices: any[];
  bookings: any[];
  inventoryitems: any[];
  /** What each seeded job is expected to demonstrate, printed alongside the audits. */
  legend: string[];
}

/**
 * One job per bucket, plus the cases that must NOT be flagged.
 *
 * The version numbers use the real encoding (major*1000 + minor), so 1001 reads
 * as v1.1 in the app.
 */
export function buildFixtures(): Seeded {
  const sows: any[] = [];
  const versions: any[] = [];
  const invoices: any[] = [];
  const legend: string[] = [];

  const addSow = (opts: { jobId: string; sowNumber: string; status: string; activeVersionNumber: number; versions: any[]; invoices?: any[]; note: string }): void => {
    const sowId = oid();
    sows.push({ _id: sowId, jobId: opts.jobId, sowNumber: opts.sowNumber, status: opts.status, activeVersionNumber: opts.activeVersionNumber, createdAt: new Date('2026-01-15') });
    for (const version of opts.versions) versions.push({ _id: oid(), sowId: String(sowId), isStaged: false, isDiscarded: false, ...version });
    for (const invoice of opts.invoices ?? []) invoices.push({ _id: oid(), jobId: opts.jobId, ...invoice });
    legend.push(`  ${opts.sowNumber} (job ${opts.jobId}) — ${opts.note}`);
  };

  addSow({
    jobId: 'job-countersigned',
    sowNumber: 'SOW 00001',
    status: 'FINAL',
    activeVersionNumber: 1001,
    versions: [{ versionNumber: 1001, status: 'FINAL', visibleToCustomer: true }],
    note: 'countersigned and in force — NOT blocked, invoiceable today and after the gate'
  });

  addSow({
    jobId: 'job-sent-not-signed',
    sowNumber: 'SOW 00002',
    status: 'SENT',
    activeVersionNumber: 1000,
    versions: [{ versionNumber: 1000, status: 'SENT', visibleToCustomer: true }],
    note: 'sent, never countersigned — blocked, and the fix is to countersign it'
  });

  addSow({
    jobId: 'job-draft-only',
    sowNumber: 'SOW 00003',
    status: 'DRAFT',
    activeVersionNumber: 0,
    versions: [{ versionNumber: 1, status: 'DRAFT', visibleToCustomer: false }],
    note: 'draft only, never issued — blocked; this is the case that can invoice TODAY off live figures'
  });

  addSow({
    jobId: 'job-withdrawn',
    sowNumber: 'SOW 00004',
    status: 'FINAL',
    activeVersionNumber: 0,
    versions: [{ versionNumber: 1001, status: 'FINAL', visibleToCustomer: true }],
    note: 'countersigned then withdrawn — blocked, and staff will remember countersigning it'
  });

  addSow({
    jobId: 'job-cancelled',
    sowNumber: 'SOW 00005',
    status: 'CANCELLED',
    activeVersionNumber: 1002,
    versions: [
      { versionNumber: 1001, status: 'FINAL', visibleToCustomer: true },
      { versionNumber: 1002, status: 'CANCELLED', visibleToCustomer: true }
    ],
    note: 'countersigned then cancelled — blocked, correctly'
  });

  addSow({
    jobId: 'job-legacy',
    sowNumber: 'SOW 00006',
    status: 'DRAFT',
    activeVersionNumber: 0,
    versions: [],
    note: 'PRE-VERSIONING, no version rows at all — the bucket that decides whether the gate ships as written'
  });

  addSow({
    jobId: 'job-legacy-billed',
    sowNumber: 'SOW 00007',
    status: 'DRAFT',
    activeVersionNumber: 0,
    versions: [],
    invoices: [{ invoiceNumber: '00007-001', voidedAt: null, services: [{ sourceIndex: 0 }] }],
    note: 'pre-versioning AND already part-invoiced — the worst case: billed once, then locked out'
  });

  addSow({
    jobId: 'job-voided-only',
    sowNumber: 'SOW 00008',
    status: 'SENT',
    activeVersionNumber: 1000,
    versions: [{ versionNumber: 1000, status: 'SENT', visibleToCustomer: true }],
    invoices: [{ invoiceNumber: '00008-001', voidedAt: new Date('2026-02-01'), voidReason: 'Wrong customer', services: [{ sourceIndex: 0 }] }],
    note: 'blocked, and its one invoice is voided — must read as NOT part-invoiced'
  });

  // Bookings: the audit only looks at ones with no customerCategory.
  const hourlyLegacy = oid();
  const hourlyInternalOnly = oid();
  const hourlyNullPrice = oid();

  const inventoryitems = [
    { _id: hourlyLegacy, name: 'Centrifuge', pricing: { legacy: 20, internal: 15 } },
    { _id: hourlyInternalOnly, name: 'Bioanalyzer', pricing: { internal: 10, external: 30 } },
    { _id: hourlyNullPrice, name: 'Thermocycler', pricing: { legacy: null, internal: 5 } }
  ];

  const bookings = [
    {
      _id: oid(),
      inventoryItem: String(hourlyLegacy),
      inventoryName: 'Centrifuge',
      ownerSub: 'sub-1',
      customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC',
      rateSnapshot: 20,
      billingStatus: 'UNBILLED',
      usageConfirmed: false
    },
    { _id: oid(), inventoryItem: String(hourlyLegacy), inventoryName: 'Centrifuge', ownerSub: 'sub-2', rateSnapshot: 20, billingStatus: 'UNBILLED', usageConfirmed: false },
    { _id: oid(), inventoryItem: String(hourlyInternalOnly), inventoryName: 'Bioanalyzer', ownerSub: 'sub-3', rateSnapshot: 10, billingStatus: 'UNBILLED', usageConfirmed: true },
    { _id: oid(), inventoryItem: String(hourlyInternalOnly), inventoryName: 'Bioanalyzer', ownerSub: 'sub-4', rateSnapshot: 10, billingStatus: 'BILLED', usageConfirmed: true },
    { _id: oid(), inventoryItem: String(hourlyNullPrice), inventoryName: 'Thermocycler', ownerSub: 'sub-5', rateSnapshot: 0, billingStatus: 'UNBILLED', usageConfirmed: true }
  ];

  legend.push('  bookings — 1 categorised (skipped), 1 on a legacy-priced item (unchanged),');
  legend.push('             2 that fell through to the internal rate (1 already BILLED), 1 billed at $0 by Number(null)');

  return { sows, versions, invoices, bookings, inventoryitems, legend };
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set. Run with: node --env-file=.env dist/dev/seed-audit-fixtures.js');
  assertLocalUri(uri);

  // Swap the database name, so the app's own data is never a target even by
  // accident. The audits are pointed at this same fixture database to read it.
  const fixtureUri = fixtureUriFrom(uri);

  await mongoose.connect(fixtureUri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');
    if (db.databaseName !== FIXTURE_DB) throw new Error(`Refusing to seed ${db.databaseName}; expected ${FIXTURE_DB}`);

    const fixtures = buildFixtures();
    for (const name of ['sows', 'sow_versions', 'invoices', 'bookings', 'inventoryitems']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('sows').insertMany(fixtures.sows);
    await db.collection('sow_versions').insertMany(fixtures.versions);
    await db.collection('invoices').insertMany(fixtures.invoices);
    await db.collection('bookings').insertMany(fixtures.bookings);
    await db.collection('inventoryitems').insertMany(fixtures.inventoryitems);

    console.log(`Seeded ${FIXTURE_DB} — your app database was not touched.`);
    console.log('');
    console.log('What is in there:');
    for (const line of fixtures.legend) console.log(line);
    console.log('');
    console.log('Now run the audits against it:');
    console.log(`  MONGO_URI=${fixtureUri} node dist/invoice/audit-countersign-gate.js`);
    console.log(`  MONGO_URI=${fixtureUri} node dist/booking/audit-booking-rates.js`);
    console.log('');
    console.log('This shows what each verdict MEANS. It cannot tell you which of these');
    console.log('shapes your real database holds — only a run against that data can.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
