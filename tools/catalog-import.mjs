#!/usr/bin/env node
/**
 * Replace the local Catalog with the contents of catalog-export.json.
 *
 *   node tools/catalog-import.mjs --dry-run      # counts only, changes nothing
 *   node tools/catalog-import.mjs
 *
 * Writes local Mongo directly rather than replaying GraphQL mutations. Two reasons:
 *
 *  1. **_id identity is preserved.** Services, categories, bundles and inventory all
 *     cross-reference each other by ObjectId (allowedConnections, category.services,
 *     bundle.services, service.inventoryRequirements, inventory.placements[].stationId).
 *     createService & co. mint fresh ids, so that path needs a five-collection id
 *     remap. Copying ids verbatim removes the whole class of bug.
 *  2. **No field loss.** `loadData` and the reset DTOs drop pricing, protocolIds,
 *     deliverables, notes, inventoryRequirements, allowMultipleRuns, isDeleted and
 *     the serviceCategory* fields. CreateService is much richer, but still omits
 *     _id / isDeleted.
 *
 * Each target collection is emptied and refilled in a transaction-free but ordered
 * pass. `uniqueId` on inventory is a sparse-unique index, hence the delete-then-insert
 * rather than an upsert.
 */

import { readFileSync } from 'node:fs';
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';

// Reads damplab-backend/.env, so this follows whatever MONGO_URI the rest of
// the backend uses rather than hardcoding a host port.
const URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/damplab';
const FILE = argValue('--in') ?? 'catalog-export.json';
const DRY = process.argv.includes('--dry-run');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/** GraphQL hands ids back as strings; a string in a ref field matches nothing and
 *  fails silently. Everything that is a ref goes through here. */
const oid = (v) => (v ? new ObjectId(String(v)) : undefined);
const oids = (a) => (Array.isArray(a) ? a.filter(Boolean).map((v) => new ObjectId(String(v))) : []);
/** Same story for dates: ISO strings sort and compare wrong against real Dates. */
const date = (v) => (v ? new Date(v) : undefined);

/** Drop undefined keys so Mongoose defaults are not overwritten with nulls. */
const clean = (doc) => Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined && v !== null));

const data = JSON.parse(readFileSync(FILE, 'utf8'));
console.log(`Source: ${data.source ?? '?'} @ ${data.exportedAt ?? '?'}`);
if (data.partial) {
  console.log(
    `\n⚠ This export was taken with --force, missing ${(data.missingPermissions ?? []).join(', ')}.\n` +
      `  Pricing and internal inventory fields are likely null throughout.\n`
  );
} else {
  console.log();
}

// ── Shape each collection ───────────────────────────────────────────────────
const plan = [
  {
    collection: 'damplabservices',
    docs: (data.services ?? []).map((s) =>
      clean({
        ...s,
        _id: oid(s.id),
        id: undefined,
        allowedConnections: oids((s.allowedConnections ?? []).map((c) => c.id)),
        inventoryRequirements: oids(s.inventoryRequirements)
      })
    )
  },
  {
    collection: 'categories',
    docs: (data.categories ?? []).map((c) =>
      clean({ _id: oid(c.id), label: c.label, services: oids((c.services ?? []).map((s) => s.id)) })
    )
  },
  {
    collection: 'bundles',
    docs: (data.bundles ?? []).map((b) =>
      clean({ _id: oid(b.id), label: b.label, icon: b.icon, services: oids((b.services ?? []).map((s) => s.id)) })
    )
  },
  {
    collection: 'inventoryitems',
    docs: (data.inventoryItems ?? []).map((i) =>
      clean({
        ...i,
        _id: oid(i.id),
        id: undefined,
        stationId: oid(i.stationId),
        placements: (i.placements ?? []).map((p) => ({ stationId: oid(p.stationId), quantity: p.quantity })),
        serviceContractExpiration: date(i.serviceContractExpiration)
      })
    )
  },
  {
    collection: 'stations',
    docs: (data.stations ?? []).map((s) => clean({ ...s, _id: oid(s.id), id: undefined }))
  },
  {
    collection: 'sow_text_presets',
    docs: (data.sowTextPresets ?? []).map((p) =>
      clean({
        ...p,
        _id: oid(p.id),
        id: undefined,
        createdAt: date(p.createdAt),
        updatedAt: date(p.updatedAt)
      })
    )
  }
];

// ── Apply ───────────────────────────────────────────────────────────────────
const client = new MongoClient(URI);
await client.connect();
const db = client.db();

console.log(`${DRY ? 'DRY RUN — ' : ''}target ${URI}\n`);
console.log('collection            before   incoming');
console.log('─'.repeat(44));

for (const { collection, docs } of plan) {
  const before = await db.collection(collection).countDocuments();
  console.log(`${collection.padEnd(22)}${String(before).padStart(6)}${String(docs.length).padStart(11)}`);

  if (DRY) continue;

  await db.collection(collection).deleteMany({});
  if (docs.length) await db.collection(collection).insertMany(docs, { ordered: false });
}

if (!DRY) {
  console.log('\nafter:');
  for (const { collection } of plan) {
    console.log(`  ${collection.padEnd(22)}${String(await db.collection(collection).countDocuments()).padStart(6)}`);
  }
}

// ── Referential integrity report ────────────────────────────────────────────
// Not a failure condition: staging itself carries dangling refs, and the GraphQL
// `services` query filters out soft-deleted rows, so anything pointing at a retired
// operation arrives here unresolvable. Reported so it is visible rather than a
// mystery blank slot in the canvas connection picker later.
if (!DRY) {
  const serviceIds = new Set((await db.collection('damplabservices').find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
  const stationIds = new Set((await db.collection('stations').find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
  const dangling = [];

  const check = (label, refs, pool) => refs.filter((r) => !pool.has(String(r))).forEach((r) => dangling.push(`${label} → ${r}`));

  for (const c of await db.collection('categories').find({}).toArray()) check(`category "${c.label}"`, c.services ?? [], serviceIds);
  for (const b of await db.collection('bundles').find({}).toArray()) check(`bundle "${b.label}"`, b.services ?? [], serviceIds);
  for (const s of await db.collection('damplabservices').find({}).toArray()) check(`service "${s.name}".allowedConnections`, s.allowedConnections ?? [], serviceIds);
  for (const i of await db.collection('inventoryitems').find({}).toArray())
    check(`inventory "${i.name}".placements`, (i.placements ?? []).map((p) => p.stationId), stationIds);

  if (dangling.length) {
    console.log(`\n⚠ ${dangling.length} dangling reference(s) — expected where a row points at a soft-deleted service:`);
    for (const d of dangling.slice(0, 15)) console.log(`    ${d}`);
    if (dangling.length > 15) console.log(`    … and ${dangling.length - 15} more`);
  } else {
    console.log('\n✓ All cross-references resolve.');
  }
}

await client.close();
console.log(`\n${DRY ? '✓ Dry run complete — nothing written.' : '✓ Catalog replaced.'}\n`);
