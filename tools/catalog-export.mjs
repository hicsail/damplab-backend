#!/usr/bin/env node
/**
 * Pull the entire Catalog out of a remote deployment (staging) over GraphQL.
 *
 * This is the half that *must* go over the network — you have no AWS/Mongo access
 * to staging, only the GraphQL endpoint. A local script works fine for it: paste a
 * Bearer token from a logged-in webapp session into STAGING_TOKEN and run.
 *
 *   STAGING_TOKEN='eyJ...' node tools/catalog-export.mjs
 *
 * Writes ./catalog-export.json (override with --out).
 *
 * The token is a short-lived Keycloak access token (minutes). Every fetch happens
 * in this one run for that reason; a 401 aborts immediately with a readable message
 * rather than writing a half-empty file.
 *
 * WHY A PERMISSION PRECHECK RUNS FIRST: pricing on services and inventory, and
 * inventory's serialNumber / hasServiceContract / serviceContractExpiration, are
 * resolved per-caller — they come back **null**, not forbidden, when your token
 * lacks `internal-fields:read`. Without the precheck you would get a syntactically
 * perfect export with every price silently missing and not find out until the local
 * catalog rendered blank.
 */

const ENDPOINT = process.env.STAGING_URL ?? 'https://damplab-backend.sail.codes/graphql';
const TOKEN = process.env.STAGING_TOKEN ?? argValue('--token');
const OUT = argValue('--out') ?? 'catalog-export.json';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

if (!TOKEN) {
  console.error(`
Missing token.

  STAGING_TOKEN='eyJ...' node tools/catalog-export.mjs

Get one from a logged-in tab on the staging webapp:

  DevTools → Network → any /graphql request → Request Headers → Authorization,
  copy everything after "Bearer ".

(keycloak-js keeps the token in memory, not localStorage, so there is nothing to
read out of storage.)
`);
  process.exit(1);
}

const PRICING = `pricing { internal externalAcademic externalMarket externalNoSalary external legacy }`;

/**
 * Field selections mirror the documents the frontend already runs
 * (damplab-ui/src/gql/queries.tsx), extended to every persisted field so the
 * export is a faithful copy rather than a view.
 */
const QUERIES = {
  services: `{ services {
      id name serviceCategoryNumber serviceCategoryName unit icon
      description parameters paramGroups result resultParams
      allowedConnections { id }
      inventoryRequirements
      price ${PRICING}
      internalPrice externalPrice externalAcademicPrice externalMarketPrice externalNoSalaryPrice
      pricingMode allowMultipleRuns deliverables notes
      protocolId protocolIds isDeleted
  } }`,

  categories: `{ categories { id label services { id } } }`,

  bundles: `{ bundles { id label icon services { id } } }`,

  // The admin query — includes soft-deleted rows. Needs `inventory:read`.
  inventoryItems: `{ inventoryItems {
      id name type description location quantity isDeleted bookable
      placements { stationId quantity }
      rateType ${PRICING}
      uniqueId tags modelNumber
      dimensionL { value unit } dimensionW { value unit } dimensionH { value unit }
      stationId
      serialNumber hasServiceContract serviceContractExpiration lastModifiedBy
  } }`,

  // Stations are not on the "catalog" menu, but InventoryItem.placements[].stationId
  // and the legacy stationId point at them. Exported so placements do not dangle.
  stations: `{ stations(includeDeleted: true) { id name type zone capacity x y notes isDeleted } }`,

  // "SOWs" here = the staff-managed SOW text-block library (/edit/sow-sections),
  // which is what lives on the Catalog editor. Job-attached SOW documents are
  // deliberately NOT exported — see the README.
  sowTextPresets: `{ sowTextPresets {
      id sectionKey name text order
      createdBy createdByName createdAt
      updatedBy updatedByName updatedAt
  } }`
};

async function gql(query, label) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ query })
    });
  } catch (err) {
    fail(`Could not reach ${ENDPOINT} while fetching ${label}: ${err.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    fail(`${res.status} on ${label}. Your token is expired or lacks access — grab a fresh one and re-run.`);
  }

  const body = await res.json().catch(() => fail(`${label}: response was not JSON (HTTP ${res.status})`));

  if (body.errors?.length) {
    const messages = body.errors.map((e) => e.message);
    // Keycloak rejections arrive as GraphQL errors, not HTTP 401 — an expired token
    // is by far the most likely failure here, so name the fix instead of the stack.
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

// ── Precheck ────────────────────────────────────────────────────────────────
const me = await gql(`{ myPermissions { effective roles } }`, 'myPermissions');
const perms = me.myPermissions.effective ?? [];
console.log(`Authenticated as roles: ${(me.myPermissions.roles ?? []).join(', ') || '(none)'}`);

const required = ['internal-fields:read', 'inventory:read'];
const missing = required.filter((p) => !perms.includes(p));
if (missing.length && !process.argv.includes('--force')) {
  fail(
    `Your token is missing ${missing.join(' and ')}.\n` +
      `  Pricing tiers and internal inventory fields would come back null and the export\n` +
      `  would look complete while silently dropping every price. Use an administrator\n` +
      `  account on staging, or re-run with --force to accept a lossy export.`
  );
}
if (missing.length) console.warn(`\n⚠  --force: proceeding without ${missing.join(', ')}. Expect null pricing.\n`);

// ── Fetch ───────────────────────────────────────────────────────────────────
const data = {};
for (const [key, query] of Object.entries(QUERIES)) {
  const result = await gql(query, key);
  data[key] = result[key];
  console.log(`  ${key.padEnd(16)} ${data[key].length}`);
}

// ── Sanity assertions ───────────────────────────────────────────────────────
const pricedServices = data.services.filter((s) => s.pricing && Object.values(s.pricing).some((v) => v !== null));
if (data.services.length && !pricedServices.length) {
  fail(`Fetched ${data.services.length} services but not one carries pricing. Refusing to write a priceless catalog.`);
}
console.log(`\n  ${pricedServices.length}/${data.services.length} services carry pricing`);

// `services` filters out soft-deleted rows server-side, so this export is the live
// catalog only. Fine here — you are also wiping local jobs, so nothing references
// a retired operation.
const { writeFileSync } = await import('node:fs');
writeFileSync(
  OUT,
  JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      source: ENDPOINT,
      // Stamped so the import can repeat the warning. A --force export looks
      // structurally identical to a complete one; this is the only thing that
      // distinguishes them.
      partial: missing.length > 0,
      missingPermissions: missing,
      ...data
    },
    null,
    2
  )
);
console.log(`\n✓ Wrote ${OUT}\n`);
