# Phase 2b — per-module narrowing checklist

**This document is Phase 2b's spec, and 2b's scope is approved from it, not from the
overhaul plan.**

**Status: the widening half is done.** Every row of "Widening debt Phase 2a created"
below has landed, along with the unguarded `template.resolver.ts` and both class-level
guards. The **narrowing** half — the module-by-module tables above it — is
deliberately *not* done: those are the rows that can break customers, and nothing
below marks them safe. The two deferred decisions are now answered at the bottom.

Four corrections found while implementing, recorded inline where they apply:
`template.resolver.ts` is Data Translation, not catalog; `/backlog` had nothing to
widen; `bookings` needs one permission, not two; and `/api/protocols/:id` was a
widening row this list missed.

Measured against the tree as it stands after Phase 2a (`npm test` green, 587 specs).

## Why this list is the dangerous half

`AuthRolesGuard` returns `true` when a handler carries no `@Roles` metadata. So
**"not decorated" means "open to any authenticated user"** — and that is
load-bearing, not an oversight: it is how `ownJobById`, `myBookings` and
`commentsByJobId` work for customers today. Attaching `@RequirePermission` to such a
method *narrows* it, and that is where every customer-facing regression will come
from.

Read the tables as: **the ones marked `KEEP OPEN` are the ones that can break
customers.** The `@Roles`-guarded methods are already staff-only and converting them
is mechanical.

## Measured state

| | Count |
|---|---:|
| `@Query` + `@Mutation` operations | 139 |
| `@ResolveField` | 31 |
| Guarded by `@Roles` (incl. class-level) | 89 |
| **Open by omission** | **81** |
|   … of which `@Query`/`@Mutation` | 51 |
|   … of which `@ResolveField` | 30 |
| Resolver files with **no `@UseGuards` at all** — no auth whatsoever | 4 |

One of the 51 open operations is `myPermissions`, added in 2a and deliberately open:
any authenticated caller must be able to ask what they may do, and the answer is
derived from their own token.

`@Roles` never appears on a `@ResolveField` anywhere in the tree. All 31 are
role-unguarded; the 30 listed below inherit no class-level role either.

## Files with NO `@UseGuards` — fix these first, they are not narrowing

These are unauthenticated today. Adding a guard is a bug fix, not a permission
decision. (`reset.resolver.ts` and `agent.controller.ts` were in this list and were
closed in Phase 0.5.)

| File | Operations | Proposed |
|---|---|---|
| `template/template.resolver.ts` | `templates`, `template`, `templateByName`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `deleteTemplateByName` | **DONE** — `@UseGuards` + `datatranslation:use` on all seven. **Not** the `catalog-editor:*` pair proposed here: `Template` is a Data Translation Excel column-mapping config, not a catalog type, and its only consumer is `/data_translation`. The name misleads. Four unauthenticated write mutations was the highest-severity item left in the tree. |
| `workflow/resolvers/edge.resolver.ts` | `source`, `target` (`@ResolveField`) | `@UseGuards` only. Field resolvers on an already-authorized parent; no permission of their own. |
| `job-version/job-version-fields.resolver.ts` | `displayVersion` | `@UseGuards` only. Presentation field. |
| `sow/sow-version-fields.resolver.ts` | `displayVersion` | `@UseGuards` only. Presentation field. |

## Module-by-module

Suggested order — each row is a reviewable unit: `inventory` → `sow` → `job` →
`workflow` → catalog (`services`, `bundles`, `categories`) → the rest.

### `inventory/inventory.resolver.ts`

| Open method | Today | Proposed |
|---|---|---|
| `inventoryItems` | any authed | `inventory:read` |
| `activeInventoryItems` | any authed | **KEEP OPEN** — feeds `BookInventory`'s picker; narrowing it to `inventory:read` is fine *only if* `inventory:book` implies `inventory:read`, which in the matrix it does not for Equipment Users. Confirm before touching. |

Plus the Q4 field strip on `inventory.model.ts`: `serialNumber` (:195),
`hasServiceContract` (:199), `serviceContractExpiration` (:203) become
`@ResolveField`s returning `null` without `internal-fields:read`. All three are
already `nullable: true`, so this is legal; all three already carry doc comments
claiming a restriction nothing enforces.

### `sow/` — 15 open, and `sow-access.ts` is the real work

`sow-access.ts:17-18` `isStaff(user)` becomes a permission lookup. **Every other
signature stays** (`isJobOwner`, `isApiKeyCaller`, `canReadSow`, `canSeeAllVersions`,
`assertStaff`, `assertJobOwner`). The signal that day-one staff access is identical:
**`sow-access.spec.ts` must pass unchanged.**

| Open method | Proposed |
|---|---|
| `sowById`, `sowByJobId` | **KEEP OPEN** — already ownership-scoped via `assertCanReadSow`. |
| `sowVersions`, `sowVersion` | **KEEP OPEN** — ownership-scoped via `canSeeAllVersions`. |
| `signSow` | **KEEP OPEN** — the customer signs. Narrowing this breaks the contract flow outright. |
| `job`, `liveServices`, `liveCustomerCategory`, `actionGate`, `currentVersion`, `activeVersion`, `versions` (`@ResolveField`) | **KEEP OPEN** — parent is already authorized. |

Indirect consumers of `sow-access.isStaff` that move with it:
`comment/comment.resolver.ts:50`, `sow/sow.resolver.ts:135,161`.

### `job/job.resolver.ts` — 26 open, the largest single module

Ownership-scoped, not role-scoped. The pattern already exists (`ownJobById` vs
`jobById`).

| Open method | Proposed |
|---|---|
| `ownJobs`, `ownJobById` | **KEEP OPEN** (`jobs:view` — baseline). The `jobs:view-all` branch is the staff side. |
| `createJob` | **KEEP OPEN** — customers submit jobs. |
| `createJobAttachmentUploadUrls`, `addJobAttachments` | **KEEP OPEN** — already owner-or-staff checked inline at `:366-369`, `:400-403`. |
| `changeJobState` | Already inline staff-checked at `:443-444`. Re-point to a permission; do not add `@RequirePermission` on top. |
| `respondToJobReview` | **KEEP OPEN** — this is the customer's half of the review loop. |
| `restoreJobVersion`, `saveJobWorkflows` | **KEEP OPEN** — go through `assertJobContractWritable`. |
| `workflows`, `attachments`, `comments`, `sow`, `versions`, `latestContentVersionNumber` (`@ResolveField`) | **KEEP OPEN** — parent authorized; `comments` and `versions` already filter by staffness inline (`:607`, `:620-621`). |

**`job/job-editing.ts` — leave alone.** `assertJobContractWritable(job, actor: { isStaff, isOwner })` takes flags as parameters precisely so it stays free of auth
types, and says so at `:90-92`. Callers pass the permission-derived value. A "can
execute but not edit the spec" technician becomes a *third flag on the actor object*,
not a rewrite.

### `workflow/` — 11 open across two resolvers

| Open method | Proposed |
|---|---|
| `node.createWorkflowParameterUploadUrls` | Needs an ownership check; today any authed user can mint upload URLs. |
| `node.workflow`, `node.job`, `node.service`, `node.formData` | **KEEP OPEN** — field resolvers. |
| `workflow.nodes`, `workflow.edges`, `workflow.job` | **KEEP OPEN** — field resolvers. |

Lab Monitor archive (`labmonitor:archive`) is a **state-transition** permission on
one mutation in `node.resolver.ts`, not a page permission: admins archive, everyone
else moves to completed. Low cost.

### Catalog — `services`, `bundles`, `categories`

| Open method | Proposed |
|---|---|
| `services`, `bundles`, `categories` | **KEEP OPEN** (`catalog:view` — baseline). `GET_SERVICES` is fetched once into the global `AppContext` and drives **both** the canvas and the catalog page. |
| `services.allowedConnections`, `bundles.services`, `categories.services` | **KEEP OPEN** — the canvas cannot render a node without them. |

Q4 field strip on `services/models/damplab-service.model.ts:162-166`: `notes` becomes
a `@ResolveField` returning `null` without `internal-fields:read`. **Keep `notes` in
`GET_SERVICES`** — staff read and edit it (`AdminEditService.tsx:141`) and it is one
shared query, so deleting the field would strip it from staff too.

**Not in scope, stated so it is not forgotten:** all internal / academic / market /
no-salary prices still ship to every caller of `services`, which has no `@Roles`.
Enforcing that needs a *separate reduced query* for the catalog page. Follow-on work.

### The rest

| File | Open | Proposed |
|---|---|---|
| `clickup/clickup.resolver.ts` | `backlogCards`, `backlogCard`, `backlogAvailable`, `addBacklogComment` | `bugbacklog:view`. Already does its own staff check at `:26-27`; re-point it. **This is a genuine narrowing** — the backlog is ungated for clients today. |
| `bug-report/bug-report.resolver.ts` | 6 | `createBugReport` + attachment mutations **KEEP OPEN** (`bugs:report` is baseline). `bugReports`, `bugReportById` → staff. |
| `comment/comment.resolver.ts` | 7 | **KEEP OPEN** — `commentsByJobId` already filters by staffness (`:50`), and customers comment on their own jobs. |
| `booking/booking.resolver.ts` | `createBooking`, `myBookings`, `cancelBooking` | `inventory:book`. Already staff/owner-checked inline at `:17-18`, `:29`, `:81`. **Genuine narrowing** — booking is ungated today. |
| `invoice/invoice.resolver.ts` | `invoicesByJobId`, `createInvoice`, `job` | **KEEP OPEN** — owner-or-staff checked inline (`:23-26`, `invoice.service.ts:35-37`). |
| `announcements/announcement.resolver.ts` | `announcements` | **KEEP OPEN** (`announcements:read` — baseline). |
| `sow-preset/sow-text-preset.resolver.ts` | `sowPresetSections`, `sowTextPresets` | Staff — these are SOW authoring internals. |

## Widening debt Phase 2a created — do this BEFORE moving anyone in Keycloak

Everything above is about *narrowing* open methods. This section is the opposite, and
it is the piece a 2b implementer would otherwise find by hand.

Phase 2a regrouped `routes.ts` by permission tier, so ten routes moved **down** out of
the admin layout. The resolvers behind them did not move: they are still
`@Roles(Role.DamplabStaff)`. **The first person moved to `technician` gets a homepage
full of buttons that open pages which 403 on load.**

This does not block the 2a deploy — nobody holds `technician` or
`client-unassisted-equipment-user` until the realm is updated, and `damplab-staff`
holds `ALL_PERMISSIONS` — but it blocks the two new roles from being *usable*, so it
must land before rollout step 4.

**All rows below have landed.** Kept as the record of what moved and why.

Verified against the tree, resolver by resolver:

| Route | Tier it now sits in | Backend operations still `@Roles(DamplabStaff)` |
|---|---|---|
| `/dashboard` | `jobs:view-all` | `allJobs`, `jobsFeedStatus`, `archiveJob`, `unarchiveJob` |
| `/technician_bench` | `bench:use` | `assignedOperations`, `setWorkflowNodeCompletedSteps` |
| `/lab-monitor/:screen` | `labmonitor:view` | `getLabMonitorNodes`, `getWorkflowsByStateForLabMonitor`, `getLabMonitorStaffList`, `getWorkflowByState`, `updateWorkflowNodeAssignee`, `updateWorkflowNodeEstimatedTime` |
| `/inventory-calendar` | `inventory:schedule` | `bookings`, `confirmBookingUsage` |
| `/inventory` | `inventory:read` | `bookings` (`activeInventoryItems`, `bundles` are already open; `getInProgressNodesHoldingInventory` was **not** open — it carried `@Roles`, and is now `inventory:read`) |
| `/protocol-map` | `protocol-library:read` | class-level `@Roles(DamplabStaff)` on the protocol-map resolver; `stations` |
| `/stations` | `lab-layout:read` | class-level `@Roles(DamplabStaff)` on the station resolver — `stations`, `createStation`, `updateStation`, `deleteStation` |
| `/edit` + 8 sub-routes | `catalog-editor:read` | the service / bundle / category / inventory **mutations** (`categories`, `inventoryItems`, `sowPresetSections` are already open) |
| `/backlog` | `bugbacklog:view` | none, and the inline check at `clickup.resolver.ts:26-27` does **not** have the same effect — it redacts the ClickUp deep link, it does not gate the queries. The backlog is deliberately readable by any authenticated user (testathon participants follow up on bugs they filed). Only the redaction was re-pointed, to `bugbacklog:view`. Gating the queries would be a genuine narrowing and is not done. |
| `/book-inventory` | `inventory:book` | none — `createBooking`, `myBookings`, `activeInventoryItems` are open |

The rule for each row: replace `@Roles(Role.DamplabStaff)` with
`@RequirePermission(<the tier's permission>)`, or the read/write pair where the matrix
splits them (e.g. `lab-layout:read` on `stations`, `lab-layout:write` on
`createStation` / `updateStation` / `deleteStation`).

**A row this list missed:** `protocols.controller.ts` (`GET /api/protocols/:id`) was
`@Roles(Role.DamplabStaff)`. It is the server-side protocols.io proxy behind
`ProtocolViewer`, which the **technician bench** renders — so My Bench 403'd on
protocol content for exactly the people the widening was for. It now takes
`bench:use` **or** `protocol-library:read`, as an inline check: `@RequirePermission`
requires *all* the permissions it lists, so an either/or is not expressible as a
decoration.

**One row needed a different permission than the table implies.** `bookings` appears
under both `/inventory` (`inventory:read`) and `/inventory-calendar`
(`inventory:schedule`), and it is one method. It takes `inventory:read`: nobody holds
schedule without read, so that satisfies both rows without over-granting.

**`confirmBookingUsage` deliberately did not move to `inventory:schedule`.** It is now
`billing:view` (Administrator-only, i.e. unchanged in effect). The matrix amendment
lets equipment users reach the calendar the button sits on, but confirming usage is
what makes a booking chargeable — a billing act, not a scheduling one.

Two smaller consequences of the same widening:

- **`Home.tsx` still keys the Jobs badge off `isStaff`.** `JOBS_FEED_STATUS` is
  fetched with `skip: !isStaff` and `markJobsFeedViewed()` is called only when
  `isStaff`. A technician now sees the Jobs button with no unseen dot. Both should key
  off `jobs:view-all` — and `markJobsFeedViewed` is itself `@Roles(DamplabStaff)`, so
  it is one of the rows in the table above.
- **`/technician_view/:id` is administrator-only under Q8**, but `/dashboard` is
  `jobs:view-all`. So a technician reaches the jobs dashboard and is bounced to `/`
  when they click into a job — and `AppBreadcrumbs` carries a trail for exactly that
  path. Encoded as the matrix specifies. Worth checking against the source
  spreadsheet: this looks more like a transcription artifact than an intent.

## The 14 inline staff checks — re-point, do not duplicate

Leaving these on `roles.includes(Role.DamplabStaff)` while resolvers move to
permissions gives the codebase two disagreeing definitions of "staff".

| Location | Note |
|---|---|
| `sow/sow-access.ts:17-18` | The big one — `comment.resolver.ts:50` and `sow.resolver.ts:135,161` depend on it. |
| `booking/booking.resolver.ts:17-18` | |
| `clickup/clickup.resolver.ts:26-27` | |
| `invoice/invoice.resolver.ts:23-24`, `invoice/invoice.service.ts:35-36` | |
| `job/job.resolver.ts:78, 104, 368, 402, 443, 607, 620` | Seven. `:104` maps to `JobVersionAuthorRole`, which is an *audit* label — think before making it permission-derived. |
| `comment/comment.service.ts:190` | Takes `isStaff` as a parameter; callers change, not this. |

`job.resolver.ts:188` and `add-node.input.ts:29` read the same raw claims but are
**pricing** derivations, already extracted in Phase 0. Not staff checks.

## Frontend write-gating — the larger half

`isDamplabStaff` appears in only a handful of places, so the re-pointing is small.
The real work is that these pages have **zero auth awareness today** — they are
staff-only by route, so `userProps` / `useEffectiveUser` appear nowhere in them.
Their read/write splits are new code, not a migration:

`Stations.tsx`, `ProtocolMap.tsx`, `Inventory.tsx`, `LabMonitor.tsx`, `Training*.tsx`,
`AdminEdit.tsx`, `AdminServicesCatalog.tsx`.

Existing gating still to re-point: `HeaderBar.tsx`, `TechnicianBench.tsx`,
`utils/jobEditing.ts:122-125`, `utils/jobEditorSave.ts:42-46`,
`components/SubmittedJobsList.tsx` (`isStaff?` prop),
`components/CommentsSection.tsx` (`currentUser.isStaff`).

Plus the Q4 catalog columns on `AdminServicesCatalog.tsx` — **explicitly labelled in
code as presentation, not enforcement**, so nobody later mistakes it for a security
boundary.

## Two decisions Phase 2a deliberately deferred

1. **API keys still bypass `@Roles`.** `authorizeApiKey` returns before the role
   check, so a key satisfies every `@Roles(Role.DamplabStaff)` query, exactly as it
   does today. 2a added permission enforcement for keys (`API_KEY_PERMISSIONS`,
   read-only, excluding `internal-fields:read`) but left the role bypass alone,
   because removing it narrows live external integrations.

   **Answer: still open, and now much smaller.** The widening work converted most
   `@Roles(DamplabStaff)` queries to `@RequirePermission`, which keys *do* get checked
   against — so the bypass now only reaches the handful of `@Roles` sites left
   (`sow.resolver.ts`, the six job contract mutations, `reset`). All but the SOW
   queries are mutations, which keys cannot call at all. Two conversions did narrow
   what a key can reach, because the permission is not in `API_KEY_PERMISSIONS`:
   `assignedOperations` (`bench:use`) and `activityEvents` (`labstatustv:view`).
   Neither is plausibly integrated against — `assignedOperations` resolves by
   `user.sub`, and a key's sub matches no assignee, so it returned an empty list
   anyway. Left narrowed rather than added to the key set.
2. **`agent.controller.ts POST /chat` is open to any authenticated user.** 2a added
   `@Roles(Role.DamplabStaff)` to `/lab-status/chat` only. `/chat` is the assistant on
   the client-facing canvas, so requiring staff would remove a customer feature.

   **Answer: `/chat` stays open.** Narrowing it would remove a feature customers have
   today. `/lab-status/chat` moved from the `damplab-staff` role to
   `labassistant:use`, which the matrix amendment now grants technicians — gating on
   the role would have left them with the homepage button and a 403.

## Verification 2b must pass

1. `sow-access` tests pass **unchanged** after `isStaff` is re-pointed.
2. Per module, an integration test that a plain customer still reaches what they
   reach today: `ownJobById`, `myBookings`, `commentsByJobId`, `invoicesByJobId` for a
   job they own, SOW read for their own job. These are precisely the open-by-omission
   methods a `@RequirePermission` would silently revoke.
3. Per role, forbidden access denied **server-side**. Hiding a control is not the
   test.
4. Internal fields **stripped, not hidden**: query `services` and `inventoryItems` as a
   client directly against GraphQL and confirm `notes`, `serialNumber`,
   `hasServiceContract`, `serviceContractExpiration` come back null.
5. Demotion is reversible: move a staging user `damplab-staff` → `technician`, confirm
   admin controls vanish, move back, confirm full access returns. This rehearses the
   only step of the rollout that can remove anything.
