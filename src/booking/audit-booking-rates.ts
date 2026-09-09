import mongoose from 'mongoose';
import { resolveCategoryPrice } from '../pricing/service-pricing.util';

/**
 * Read-only audit: which existing bookings were priced by the chain that has since
 * been replaced.
 *
 * `BookingService.resolveRate` **has now been deleted** in favour of the shared
 * `resolveCategoryPrice`, and the customer category is resolved at booking creation
 * so the uncategorised path is rare rather than routine. This audit is therefore
 * retrospective: `rateSnapshot` is written once and never revisited, so every
 * booking made before that change still carries whatever the old chain gave it.
 *
 * `resolveRate` was a second copy of the resolution `service-pricing.util.ts`
 * documents as THE chain. On the four named categories the two agreed. They
 * diverged in exactly two places, and both only bite a booking whose
 * `customerCategory` is absent:
 *
 *   - **the uncategorised fallback.** `resolveRate` returns
 *     `legacy ?? internal ?? external`, handing an *internal* rate to a caller
 *     whose category is unknown. `resolveCategoryPrice` returns `legacy ?? price`
 *     and stops — which is the leak `pricing-visibility.ts` exists to prevent.
 *   - **coercion.** `resolveRate` uses `Number(v)`, and `Number(null)` is `0`, so
 *     a null price becomes a free booking. `normalizePrice` rejects null.
 *
 * Two lists come out of this, and they need different answers:
 *
 *   - `repriced` — the rate the new chain gives differs from the one the old chain
 *     gives against today's catalog. These are the bookings whose price moves.
 *   - `uncostable` — the new chain resolves nothing at all. These used to bill at
 *     **$0** through `UsageBillingService.toLineItem` (`cost: round2(b.cost ?? 0)`),
 *     silently; `generateBilling` now refuses them outright. The remedy is to give
 *     the owner a pricing group and re-book, since `rateSnapshot` is never revisited.
 *
 * Both lists flag `alreadyBilled`, because `rateSnapshot` is written once at
 * creation and a billed booking cannot be re-rated retroactively.
 *
 * **Expect `uncostable` to hold everything and `repriced` to be empty.**
 * `InventoryItem` carries only a `pricing` object — no flat `price` field — so the
 * new chain's whole uncategorised answer is `pricing.legacy`. Whenever the old
 * chain fell through to `internal` or `external`, the new one resolves *nothing*,
 * which is `uncostable` rather than a different number. `repriced` therefore only
 * catches a type-coercion edge (`Number(true)` is 1, `Number([])` is 0, both of
 * which `normalizePrice` rejects) and is kept because a silently changed rate is
 * worth surfacing separately from a missing one if it ever occurs.
 *
 * That emptiness is the point rather than an anticlimax: it is the evidence for
 * why the plan resolves the customer category at booking creation instead of
 * swapping the chain on its own.
 *
 * Writes nothing, ever. There is no --dry because there is no apply.
 */

/**
 * The replaced chain, reproduced here so the audit can diff old against new.
 *
 * Deliberately a copy rather than an import: the original is gone, and this has to
 * keep describing what those stored `rateSnapshot` values came from however the
 * live chain evolves.
 */
function legacyResolveRate(pricing: any, category?: string): number | undefined {
  if (!pricing || typeof pricing !== 'object') return undefined;
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  switch (category) {
    case 'INTERNAL_CUSTOMERS':
      return num(pricing.internal) ?? num(pricing.legacy);
    case 'EXTERNAL_CUSTOMER_ACADEMIC':
      return num(pricing.externalAcademic) ?? num(pricing.external) ?? num(pricing.legacy);
    case 'EXTERNAL_CUSTOMER_MARKET':
      return num(pricing.externalMarket) ?? num(pricing.external) ?? num(pricing.legacy);
    case 'EXTERNAL_CUSTOMER_NO_SALARY':
      return num(pricing.externalNoSalary) ?? num(pricing.external) ?? num(pricing.legacy);
    default:
      return num(pricing.legacy) ?? num(pricing.internal) ?? num(pricing.external);
  }
}

export interface AuditedBooking {
  bookingId: string;
  inventoryName: string;
  ownerSub: string;
  customerCategory: string | null;
  /** The rate stored when the booking was made. */
  rateSnapshot: number | null;
  /** What the old chain gives against today's catalog pricing. */
  oldRate: number | null;
  /** What the new chain gives against today's catalog pricing. */
  newRate: number | null;
  alreadyBilled: boolean;
  usageConfirmed: boolean;
  /** True when the stored rate no longer matches either chain — the item was repriced since. */
  catalogDrifted: boolean;
}

export interface BookingRateAuditReport {
  scannedBookings: number;
  /** Bookings that carry a category — unaffected, the two chains agree. */
  categorised: number;
  /** Uncategorised bookings whose inventory item is gone; nothing can be computed. */
  itemMissing: number;
  repriced: AuditedBooking[];
  uncostable: AuditedBooking[];
}

export async function auditBookingRates(db: mongoose.mongo.Db): Promise<BookingRateAuditReport> {
  const bookings = await db.collection('bookings').find({}).toArray();
  const items = await db.collection('inventoryitems').find({}).toArray();
  const itemById = new Map(items.map((item) => [String((item as any)._id), item as any]));

  const report: BookingRateAuditReport = {
    scannedBookings: bookings.length,
    categorised: 0,
    itemMissing: 0,
    repriced: [],
    uncostable: []
  };

  for (const booking of bookings) {
    const category = (booking as any).customerCategory ? String((booking as any).customerCategory) : null;
    if (category) {
      // The two chains agree on every named category, so these cannot move.
      report.categorised += 1;
      continue;
    }

    const item = itemById.get(String((booking as any).inventoryItem ?? ''));
    if (!item) {
      report.itemMissing += 1;
      continue;
    }

    const oldRate = legacyResolveRate(item.pricing, undefined);
    const newRate = resolveCategoryPrice(item, undefined);
    const rateSnapshot = typeof (booking as any).rateSnapshot === 'number' ? (booking as any).rateSnapshot : null;

    const row: AuditedBooking = {
      bookingId: String((booking as any)._id),
      inventoryName: String((booking as any).inventoryName ?? item.name ?? '(unnamed)'),
      ownerSub: String((booking as any).ownerSub ?? ''),
      customerCategory: null,
      rateSnapshot,
      oldRate: oldRate ?? null,
      newRate: newRate ?? null,
      alreadyBilled: (booking as any).billingStatus === 'BILLED',
      usageConfirmed: (booking as any).usageConfirmed === true,
      // The snapshot is what actually bills; a mismatch with the old chain means
      // the item was repriced after the booking was made, so this row's "old rate"
      // is not what it would actually charge.
      catalogDrifted: rateSnapshot !== null && oldRate !== undefined && rateSnapshot !== oldRate
    };

    if (newRate === undefined) {
      report.uncostable.push(row);
    } else if (oldRate !== newRate) {
      report.repriced.push(row);
    }
  }

  return report;
}

function describe(label: string, rows: AuditedBooking[]): void {
  if (rows.length === 0) return;
  console.warn(`  ${label}: ${rows.length} (${rows.filter((r) => r.alreadyBilled).length} already billed)`);
  for (const row of rows.slice(0, 20)) {
    const money = `stored $${row.rateSnapshot ?? '—'} · old $${row.oldRate ?? '—'} · new $${row.newRate ?? 'none'}`;
    const flags = [row.alreadyBilled ? 'BILLED' : null, row.catalogDrifted ? 'catalog drifted' : null].filter(Boolean).join(', ');
    console.warn(`    - ${row.inventoryName} (${row.bookingId}) — ${money}${flags ? ` [${flags}]` : ''}`);
  }
  if (rows.length > 20) console.warn(`    … and ${rows.length - 20} more (see the JSON above)`);
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set. Run with: node --env-file=.env dist/booking/audit-booking-rates.js');

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');

    const report = await auditBookingRates(db);
    console.log('Read-only audit — nothing was written.');
    console.log(JSON.stringify(report, null, 2));

    if (report.repriced.length === 0 && report.uncostable.length === 0) {
      console.log('No existing booking was priced differently by the old chain. Nothing to correct.');
      return;
    }

    console.warn('Uncategorised bookings affected by the shared pricing chain:');
    describe('repriced (the uncategorised fallback stops handing out the internal rate)', report.repriced);
    describe('UNCOSTABLE — bill at $0 today, refused at billing under the fix', report.uncostable);

    if (report.uncostable.length > 0) {
      console.warn('');
      console.warn('Give those owners a Keycloak pricing group and re-book, or record those charges manually — generateBilling refuses them rather than billing $0.');
    }
    // Non-zero exit so a CI or SSM caller cannot mistake this for a clean run.
    process.exitCode = 1;
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
