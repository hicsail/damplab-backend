# DAMPLab Canvas — access matrix

> **Provenance — read this first.**
> The authoritative access matrix is a spreadsheet that lives **outside version
> control**. This file was **transcribed from the role & permission overhaul plan**,
> which itself encodes the spreadsheet in prose. It has **not** been diffed against
> the spreadsheet.
>
> `damplab-backend/src/auth/permissions/role-permissions.spec.ts` asserts against
> this file, so that spec currently tests *self-consistency with this transcription*,
> not correctness against the source. **Diff this file against the spreadsheet and
> delete this notice** — until then, treat every cell as unverified.

## The four columns

| Matrix column | Access group (what admins click) | Realm role (what the guard reads) |
|---|---|---|
| Administrator | `damplab-staff` | `damplab-staff` |
| Technician | `technician` | `technician` |
| Client | *(none — Client is the floor, not a grant)* | *(none required — the code baseline)* |
| Client Unassisted Equipment User | `client-unassisted-equipment-users` | `client-unassisted-equipment-user` |

**Client is not something you assign.** It is what every authenticated user has when
they carry no access group at all. It is implemented as `BASELINE_PERMISSIONS` in
`role-permissions.ts`, not as a role mapping, so no missing role can lock anyone out.

**Pricing is a separate axis entirely.** The five pricing groups
(`internal-customers`, `external-customers`, `external-customer-{academic,market,no-salary}`)
determine price and have **no access effect**. Any pricing group combines with any
access group. See `damplab-backend/src/pricing/pricing-groups.ts`.

## Permissions by role

`✓` = granted. Permissions **union** across a user's roles, so a user holding both
`damplab-staff` and `technician` has Administrator access.

| Permission | Admin | Technician | Equipment User | Client |
|---|:---:|:---:|:---:|:---:|
| `jobs:view` — see jobs you own | ✓ | ✓ | ✓ | ✓ |
| `jobs:view-all` — the staff jobs dashboard | ✓ | ✓ | | |
| `job:submit-for-client` — Staff submit job (Q7) | ✓ | | ✓ | |
| `releasenotes:view` | ✓ | ✓ | ✓ | ✓ |
| `announcements:read` | ✓ | ✓ | ✓ | ✓ |
| *(An announcement may be addressed to any subset of these four columns. The permission gates the page; the audience gates the rows, server-side. Absent or empty audience = everyone, which is how notices written before targeting existed keep working.)* | | | | |
| `announcements:write` | ✓ | | | |
| `training:read` — Learning Hub | ✓ | ✓ | ✓ | ✓ |
| `training:write` | ✓ | | | |
| `bugs:report` | ✓ | ✓ | ✓ | ✓ |
| `bugbacklog:view` | ✓ | ✓ | | |
| `catalog:view` — the services catalog page | ✓ | ✓ | ✓ | ✓ |
| `catalog-editor:read` | ✓ | ✓ | | |
| `catalog-editor:write` | ✓ | | | |
| `protocol-library:read` | ✓ | ✓ | | |
| `protocol-library:write` | ✓ | ✓ | | |
| `lab-layout:read` | ✓ | ✓ | | |
| `lab-layout:write` | ✓ | | | |
| `inventory:read` | ✓ | ✓ | ✓ | |
| `inventory:write` | ✓ | | | |
| `inventory:book` — Book Inventory | ✓ | ✓ | ✓ | |
| `inventory:schedule` — Inventory Schedule | ✓ | ✓ | ✓ | |
| `labmonitor:view` | ✓ | ✓ | ✓ | |
| `labmonitor:archive` | ✓ | | | |
| `labstatustv:view` | ✓ | | | |
| `bench:use` — My Bench (technician bench) | ✓ | ✓ | ✓ | |
| `billing:view` — Billing / usage billing | ✓ | | | |
| `customers:manage` — Customer Management | ✓ | | | |
| `apikeys:manage` — API Keys | ✓ | | | |
| `datatranslation:use` — Data Translation | ✓ | | | |
| `labassistant:use` — AI Lab Assistant | ✓ | ✓ | | |
| `internal-fields:read` — staff-only model fields | ✓ | ✓ | | |

`internal-fields:read` is **enforced** as of the catalog work. Without it:

- `DampLabService.notes` and inventory's `serialNumber` / `hasServiceContract` /
  `serviceContractExpiration` resolve to `null` (rather than being omitted from the
  query shape — one shared query drives both staff and client pages).
- Every **pricing tier the caller is not in** resolves to null, on both
  `DampLabService.pricing` and `InventoryItem.pricing`, and on the five deprecated
  flat price fields. The generic `external` and `legacy` fallbacks stay visible:
  they are not another customer's rate, they are where every tier's resolution chain
  ends.
- `catalogServices.pricing` and `catalogServices.parameters` are null entirely — the
  client-facing catalog page shows one price, the caller's own, resolved
  server-side.

### Amendments to the transcription

Three cells were changed after the Phase 2a transcription, on request. **They are
not yet in the source spreadsheet** — mirror them there.

| Cell | Was | Now | Why |
|---|---|---|---|
| `labassistant:use` | Admin only | **+ Technician** | Requested. |
| `inventory:schedule` | Admin + Technician | **+ Equipment User** | Requested. Equipment users should reach Inventory Schedule. |
| `bench:use` | Admin + Technician | **+ Equipment User** | Requested. Equipment users should reach My Bench. |
| `/technician_view/:id` (Q8) | Administrator only | **`jobs:view-all`** | The merged Jobs page makes it reachable for the first time: `/dashboard` is `jobs:view-all`, so keying the link off anything narrower means a technician clicks a job and bounces to `/`. |
| Homepage: My Jobs + Jobs | Two buttons, two sections | **One button, Client Tools** | The two pages rendered the same component; scope is enforced server-side now. Client Tools because the baseline holds `jobs:view`. |

Two notes on the equipment-user grants, because a bare table edit misses both:

- **My Bench self-scopes already.** `assignedOperations` resolves by `user.sub`, so
  an equipment user sees only their own operations.
- **Inventory Schedule does not.** `InventoryCalendar` shows every booking in the
  lab. Cancel is gated per row on ownership, and **Confirm usage stays
  Administrator-only** — it feeds usage billing, so it is a billing act, not a
  scheduling one. Widening it is a separate decision.

**Q8 — pages absent from the matrix are Administrator-only.** That covers
`/dominos`, `/elabs`, `/kernel`, `/technician_view/:id`, `/training/admin-edit` and
`/test_page`. None has a homepage button. Note `/test_page` sits outside both route
layouts today, i.e. it is unauthenticated.

## Homepage sections

**Sections are topical, not audience-scoped.** A section named "Technician Tools" may
contain a button a technician cannot use, and "Client Tools" may contain buttons a
plain client cannot use. Do not regroup buttons to match permissions — that silently
diverges from the matrix. A section with zero visible buttons hides itself entirely;
that is the only coupling between grouping and permission.

| Section | Buttons |
|---|---|
| **Client Tools** | Jobs, Order Services, Catalog, Book Inventory, Learning Hub, Announcements, Bugs, Bug Backlog, DAMP Lab Website |
| *(Announcements here is the read-only feed at `/announcements`, `announcements:read` — baseline. The editor is "Edit Announcements" under Admin Operational Tools, `announcements:write`.)* | |
| **Technician Tools** | Staff submit job, My Bench |
| **Operational Tools** | Inventory Availability, Inventory Schedule |
| **Admin Operational Tools** | Release Notes, Catalog & Inventory Editor, Protocol Library, Lab Layout, Edit Announcements, Billing, AI Lab Assistant |
| **Admin Management Tools** | Customer Management, API Keys, Data Translation, Lab Monitor North, Lab Monitor South, Lab Status TV |

Two deliberate oddities, both consequences of the topical grouping:

- *Client Tools* contains **Book Inventory** and **Bug Backlog**, which the matrix
  restricts above Client. Both are ungated today, so restricting them is a genuine
  narrowing of access clients currently have — the one place "nothing is revoked"
  does not hold.
- *Technician Tools* contains **Staff submit job**, which the matrix gives to
  Equipment Users and **not** Technicians (Q7). So an equipment user sees that section
  with exactly one button, and a technician sees it without that button.

## Renames (Phase 1)

| Was | Now | Route |
|---|---|---|
| Catalog Editor | Catalog & Inventory Editor | `/edit` |
| Protocol Map | Protocol Library | `/protocol-map` |
| Lab Stations | Lab Layout | `/stations` |
| Usage Billing | Billing | `/usage-billing` |
| Lab Status Assistant | AI Lab Assistant | `/lab-assistant` |
| Canvas | Order Services *(homepage button only — the product is still Canvas)* | `/canvas` |
| Services Catalog | Catalog | `/services-catalog` |
| DAMPLab Site | DAMP Lab Website | external |
| — | Bug Backlog *(new homepage button)* | `/backlog` |

Routes are unchanged; only labels move. Each rename must land in three places —
the homepage button, `AppBreadcrumbs`' `STATIC` map, and the page's own heading.
