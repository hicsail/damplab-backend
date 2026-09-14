import mongoose from 'mongoose';
import { resolveCategoryPrice, RUN_COUNT_PARAM_ID } from './service-pricing.util';
import { CustomerCategory } from './customer-category';

/**
 * Read-only audit: which catalog services are repriced by scoping a priced
 * multiplier parameter to itself.
 *
 * Run this BEFORE deploying that change. In `PARAMETER` pricing mode a
 * multiplier parameter used to scale the whole line, so a service with a $100
 * instrument option and a $40/hr parameter billed `(100 + 40) x hours`. It now
 * bills `100 + 40 x hours`. Any service configured that way therefore changes
 * price — always downward, since the fixed part stops being multiplied — and
 * the lab should see the list before it moves, not after.
 *
 * A service is only affected when all three hold:
 *   - `pricingMode` is PARAMETER, and
 *   - a parameter has `isPriceMultiplier: true`, and
 *   - that same parameter resolves to a price in at least one customer category.
 *
 * A multiplier parameter with no price of its own is untouched: it still scales
 * the line, because there is nothing that could have been double-counted. So is
 * the universal run count, which never carries a price.
 *
 * Writes nothing, ever. There is no --dry because there is no apply.
 */

/** Every tier, because a service priced for one category only is still affected. */
const CATEGORIES: (CustomerCategory | undefined)[] = [
  undefined,
  CustomerCategory.INTERNAL_CUSTOMERS,
  CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC,
  CustomerCategory.EXTERNAL_CUSTOMER_MARKET,
  CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY
];

export interface AffectedParameter {
  parameterId: string;
  parameterName: string;
  /** The categories in which this parameter resolves to a price. */
  pricedCategories: string[];
}

export interface AffectedService {
  serviceId: string;
  name: string;
  isDeleted: boolean;
  parameters: AffectedParameter[];
}

export interface MultiplierPricingAuditReport {
  scannedServices: number;
  parameterModeServices: number;
  /** Multiplier parameters that carry no price — untouched by the change. */
  unpricedMultiplierParameters: number;
  affected: AffectedService[];
}

/**
 * Which tiers this parameter resolves a price in.
 *
 * A flat `price` (or `pricing.legacy`) is the end of every resolution chain, so
 * it answers for all of them. Reporting it as one entry rather than five keeps
 * the list readable — the point of the report is which services move, not a
 * re-derivation of the tier table.
 */
function pricedCategoriesFor(param: unknown): string[] {
  if (resolveCategoryPrice(param as any, undefined) !== undefined) return ['all categories'];
  return CATEGORIES.filter((category) => category !== undefined && resolveCategoryPrice(param as any, category) !== undefined).map((category) => String(category));
}

export async function auditMultiplierPricing(db: mongoose.mongo.Db): Promise<MultiplierPricingAuditReport> {
  const services = await db.collection('damplabservices').find({}).toArray();

  const report: MultiplierPricingAuditReport = {
    scannedServices: services.length,
    parameterModeServices: 0,
    unpricedMultiplierParameters: 0,
    affected: []
  };

  for (const service of services) {
    if ((service as any).pricingMode !== 'PARAMETER') continue;
    report.parameterModeServices += 1;

    const parameters = Array.isArray((service as any).parameters) ? (service as any).parameters : [];
    const affectedParams: AffectedParameter[] = [];

    for (const param of parameters) {
      if (!param || typeof param !== 'object') continue;
      if (param.isPriceMultiplier !== true) continue;
      if (param.id === RUN_COUNT_PARAM_ID) continue;

      const pricedCategories = pricedCategoriesFor(param);
      if (pricedCategories.length === 0) {
        report.unpricedMultiplierParameters += 1;
        continue;
      }
      affectedParams.push({
        parameterId: String(param.id ?? '(no id)'),
        parameterName: String(param.name ?? param.id ?? '(unnamed)'),
        pricedCategories
      });
    }

    if (affectedParams.length > 0) {
      report.affected.push({
        serviceId: String((service as any)._id),
        name: String((service as any).name ?? '(unnamed)'),
        isDeleted: (service as any).isDeleted === true,
        parameters: affectedParams
      });
    }
  }

  return report;
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set. Run with: node --env-file=.env dist/pricing/audit-multiplier-pricing.js');

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');

    const report = await auditMultiplierPricing(db);
    console.log('Read-only audit — nothing was written.');
    console.log(JSON.stringify(report, null, 2));

    if (report.affected.length === 0) {
      console.log('No service is repriced by scoping priced multipliers. The change is safe to deploy as-is.');
      return;
    }
    // Non-zero exit so a CI or SSM caller cannot mistake this for a clean run.
    console.warn(`${report.affected.length} service(s) will be repriced. Review each with the lab before deploying:`);
    for (const service of report.affected) {
      const params = service.parameters.map((p) => `${p.parameterName} (${p.pricedCategories.join(', ')})`).join('; ');
      console.warn(`  - ${service.name}${service.isDeleted ? ' [deleted]' : ''}: ${params}`);
    }
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
