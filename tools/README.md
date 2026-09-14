# Staging → local catalog sync

Three dev-only scripts for pulling the Catalog out of a deployment you can only
reach over GraphQL, and replacing your local copy with it.

Run them from `damplab-backend/` (they resolve the `mongodb` driver from its
`node_modules`). Node 18+.

## What "Catalog" means here

The five things behind `PrivateRouteCatalogEditor` (`/edit`), plus one dependency:

| Exported | Local collection |
|---|---|
| Operations (services) | `damplabservices` |
| Categories | `categories` |
| Bundles | `bundles` |
| Inventory | `inventoryitems` |
| SOW text presets (`/edit/sow-sections`) | `sow_text_presets` |
| Stations — *added* | `stations` |

**Stations were added** because `InventoryItem.placements[].stationId` and the
legacy `stationId` point at them; without them every equipment→station placement
would dangle locally.

**"SOWs" is read as the SOW text-block library, not job-attached SOW documents.**
Those are per-job (`SOW.jobId` is required and unique) with version history and
signatures, so they cannot be transferred without also transferring the jobs and
their owners — and they would dangle against the jobs `wipe-jobs.mjs` deletes. If
you actually meant job SOWs, that is a different and much larger job.

## Usage

```bash
# 1. Pull from staging. Token comes from a logged-in webapp session.
STAGING_TOKEN='eyJ...' node tools/catalog-export.mjs

# 2. Look before you leap.
node tools/catalog-import.mjs --dry-run
node tools/catalog-import.mjs

# 3. Clear local jobs (separate, also dry-runnable).
node tools/wipe-jobs.mjs --dry-run
node tools/wipe-jobs.mjs
```

`MONGO_URI` is read from `damplab-backend/.env` (falling back to :27017); `STAGING_URL`
defaults to `https://damplab-backend.sail.codes/graphql`.

Restart `npm run start:dev` after importing — the catalog is read into the
frontend's `AppContext` once at load.

## Why direct Mongo writes rather than mutations

Two reasons, both load-bearing:

1. **`_id` identity is preserved.** Services, categories, bundles and inventory
   cross-reference each other by ObjectId. `createService` & co. mint fresh ids, so
   the mutation path needs a five-collection id remap. Copying ids verbatim deletes
   that entire class of bug.
2. **No field loss.** The `loadData` reset DTO drops `pricing`, `protocolIds`,
   `deliverables`, `notes`, `inventoryRequirements`, `allowMultipleRuns`,
   `isDeleted` and the `serviceCategory*` fields. `CreateService` is far richer
   (`OmitType(DampLabService, ['_id','allowedConnections','isDeleted'])`) but still
   cannot set `_id` or `isDeleted`.

**Do not use `clearDatabase` / `loadData`.** Both drop the *entire* database —
announcements, training resources, api keys and stations included — and `loadData`
covers only services, categories and bundles.

## Things that will bite you

- **Pricing is per-caller.** `pricing` on services and inventory, and inventory's
  `serialNumber` / `hasServiceContract` / `serviceContractExpiration`, resolve to
  **null** without `internal-fields:read` — no error, just missing data. The export
  aborts up front unless your token carries `internal-fields:read` and
  `inventory:read`. `--force` overrides, lossily.
- **Tokens expire in minutes.** The export does every fetch in one run for that
  reason, and fails fast with a readable message.
- **Soft-deleted operations are not exported.** The `services` query filters
  `isDeleted: true` server-side, so retired operations do not come across and
  anything referencing them will dangle. The import prints a referential-integrity
  report so this is visible rather than a mystery blank later.
- **Duplicate refs exist in real data** (e.g. a bundle listing the same service
  twice). Reproduced faithfully; harmless.

## Job deletion is a cascade

There is no `deleteJob` mutation — job deletion was never an exposed operation.
`wipe-jobs.mjs` clears every collection whose model carries a job reference:
`jobs`, `workflows`, `workflownodes`, `workflowedges`, `job_versions`,
`job_review_operations`, `job_feed_status`, `sows`, `sow_versions`, `comments`,
`invoices`, `usagesows`, `usageinvoices`, `activity_events`, `notifications`.

Deleting `jobs` alone leaves the rest as unreachable garbage that still surfaces in
staff queries.

Not touched: the catalog, announcements, training resources, api keys, stations,
bookings, and the `guides` / `sequences` / `screening*` collections (no model in the
current tree).

## The GraphQL-mutation path (fallback)

If you want to stay entirely in GraphQL rather than touching Mongo, the pieces
exist — there is just no single bulk-replace mutation, so it is a loop per
collection. All of these need `catalog-editor:write` (inventory needs
`inventory:write`), which `DISABLE_AUTH=true` grants locally.

| Collection | Create | Wipe first |
|---|---|---|
| Services | `createService(service: CreateService!)` | `deleteService(service: ID!)` per row |
| Categories | `createCategory(category: CreateCategory!)` | `deleteCategory(category: ID!)` per row |
| Bundles | `createBundle(bundle: CreateBundle!)` | `deleteBundle(bundle: ID!)` per row |
| Inventory | `createInventoryItem(item: CreateInventoryItem!)` | `deleteAllInventoryItems` — one call, hard delete |
| SOW presets | `createSowTextPreset(preset: CreateSowTextPresetInput!)` | `deleteSowTextPreset(id: ID!)` per row |

`CreateService` is `OmitType(DampLabService, ['_id','allowedConnections','isDeleted'])`
— i.e. it *does* carry pricing, protocolIds, deliverables, notes, allowMultipleRuns
and the serviceCategory* fields. That is the difference between this path being
usable and not; the far poorer `ServiceInput` on the reset module is not the same
type.

What this path still costs you:

- **A five-collection id remap.** New `_id`s are minted, so you must create
  services first, keep an old-id → new-id map, and rewrite `allowedConnections`,
  `category.services`, `bundle.services` and `service.inventoryRequirements`
  through it before creating the dependents. `createService` takes
  `allowedConnections: [ID!]`, so it is a two-pass write (create bare, then update).
- **`isDeleted` cannot be set**, so soft-deleted rows cannot be reproduced.
- **`deleteInventoryItem` is a soft delete** — use `deleteAllInventoryItems` for a
  real wipe.
- **SOW preset authorship and timestamps are rewritten** to the calling user and
  now; `createdBy` / `createdAt` are server-set, not inputs.
- Still no job deletion — that has no mutation at all.

## What was verified

- **All six export queries validate against the live staging schema.** GraphQL
  validates before executing, so each was sent to staging unauthenticated: every one
  came back with an auth error rather than a "Cannot query field" error, which means
  the field selections are correct. (Introspection is open unauthenticated on
  staging, if you want to re-check after a schema change.)
- **Scalar shapes confirmed by introspection**, not assumed:
  `InventoryItem.serviceContractExpiration` is `DateTime` (ISO string → converted to
  a real `Date`), and `DampLabService.inventoryRequirements` is `[String]` of
  ObjectId strings (→ converted to real `ObjectId`s).
- **Import round-trip tested** against a scratch database: `_id`, `allowedConnections`,
  `category.services`, `bundle.services` all land as real `ObjectId`s, SOW preset
  timestamps as real `Date`s, no stray GraphQL `id` field, and every cross-reference
  resolves.
- **`wipe-jobs.mjs --dry-run`** counts match the live local collections exactly.

Not verified end to end: booting the API against a freshly imported database. The
working tree currently has unrelated TypeScript errors (in-flight SOW changes) that
stop `npm run start:dev` from compiling. Because the raw driver bypasses Mongoose
validation, once the tree compiles it is worth running `services` and
`inventoryItems` through local GraphiQL after the first real import — a malformed
`rateType` enum or `dimension` subdocument would only surface there.

---

# Job graph sync (`jobs-export.mjs` / `jobs-import.mjs`)

The companion to the catalog pair, covering what `wipe-jobs.mjs` deletes.

```bash
STAGING_TOKEN='eyJ...' node tools/catalog-export.mjs   # catalog FIRST
node tools/catalog-import.mjs
STAGING_TOKEN='eyJ...' node tools/jobs-export.mjs
node tools/jobs-import.mjs --dry-run
node tools/jobs-import.mjs --own
```

**Order matters.** Workflow nodes reference services by ObjectId, so a job export
only lines up with a catalog exported from the *same* deployment. The import ends
with an integrity report that says whether every node resolved.

**`--own`** rewrites each job's `sub` to the local dev identity (`dev`, matching
`AuthRolesGuard.devUser()`). Without it the jobs belong to staging Keycloak
subjects: fine as an administrator, but a client-tier walkthrough shows an empty
dashboard, because `jobsForViewer` scopes to the caller server-side.

## This export contains real customer PII

`sub`, `email`, `clientEmail`, `clientDisplayName`, `institute`, signature names,
and free-text notes that may describe real research. The file is unencrypted;
`/*-export.json` is gitignored, but that is the only guard.

## What cannot be transferred

Not a limitation of the scripts — the schema exposes no way to read these:

| Collection | Why |
|---|---|
| `job_review_operations` | no resolver at all |
| `job_feed_status` | no resolver at all |
| `notifications` | only `myNotifications`, scoped to the caller |
| `usagesows` / `usageinvoices` | `usageSows(ownerSub)` needs a per-owner fan-out over subjects the export cannot enumerate |
| S3 attachment **bodies** | only presigned per-request URLs; metadata does come over |

`jobs-import.mjs` **clears these but never repopulates them**, and says so in its
output. Four job fields are also unexposed and therefore lost:
`editAccessRequestedAt`, `lastReviewOperationId` (Job), `isStaged` (SowVersion).

**Workflow edge `_id`s cannot round-trip** — `WorkflowEdge` exposes only the
ReactFlow-side `id` string. The import mints fresh `_id`s and builds
`workflows.edges` from those same values, so the pair stays consistent. Nothing
else references an edge by `_id`.

## Reference types are not uniform — do not "tidy" them

Verified against live documents; getting these wrong fails silently, because a
string never matches an `ObjectId` query and vice versa:

| Collection | Shape |
|---|---|
| `job_versions` | `jobId` **string** (a documented "string mirror, for querying") + `job` ObjectId |
| `sows` | `jobId` **string** + `job` ObjectId |
| `sow_versions` | `sowId` **string** + `sow` ObjectId |
| `invoices` | `jobId` **string** + `job` ObjectId |
| `activity_events` | `jobId` **string** |
| `comments` | `jobId` **ObjectId** — the exception |
| `workflows` | `nodes`/`edges` ObjectId arrays; **no** `job` field |
| `workflownodes` | `service` ObjectId; **no** `workflow`/`job` fields |

## What was verified

Round-tripped local → export shape → scratch database, then compared every
document field-by-field against the source: **all ten collections match on every
persisted field and type**, and every reference resolves — `workflow.nodes`,
`workflow.edges`, `job.workflows`, edge `source`/`target` → nodes, plus the
string-keyed `job_versions`, `sows`, `sow_versions` lookups. `--own` verified to
rewrite `sub`. All five export queries validate against the live staging schema.
