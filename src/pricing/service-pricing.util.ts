import { DampLabService, ServicePricingMode } from '../services/models/damplab-service.model';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../workflow/utils/form-data.util';

interface ServiceParameterOption {
  id?: unknown;
  name?: unknown;
  price?: unknown;
  internalPrice?: unknown;
  externalPrice?: unknown;
  pricing?:
    | {
        internal?: unknown;
        external?: unknown;
        externalAcademic?: unknown;
        externalMarket?: unknown;
        externalNoSalary?: unknown;
        legacy?: unknown;
      }
    | unknown;
}

interface ServiceParameterDefinition {
  id?: unknown;
  allowMultipleValues?: boolean;
  price?: unknown;
  internalPrice?: unknown;
  externalPrice?: unknown;
  pricing?:
    | {
        internal?: unknown;
        external?: unknown;
        externalAcademic?: unknown;
        externalMarket?: unknown;
        externalNoSalary?: unknown;
        legacy?: unknown;
      }
    | unknown;
  type?: unknown;
  options?: ServiceParameterOption[] | unknown;
  isPriceMultiplier?: boolean;
}

export type CustomerCategory = 'INTERNAL_CUSTOMERS' | 'EXTERNAL_CUSTOMER_ACADEMIC' | 'EXTERNAL_CUSTOMER_MARKET' | 'EXTERNAL_CUSTOMER_NO_SALARY';

/**
 * Id of the universal run count. The UI injects it into formData for every service
 * rather than adding it to each service's stored parameters, so it will not appear
 * in service.parameters and has to be read straight from formData.
 * Must stay in sync with RUN_COUNT_PARAM_ID in damplab-ui/src/utils/servicePricing.ts.
 */
export const RUN_COUNT_PARAM_ID = '__runCount';

function normalizePrice(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveCategoryPrice(
  input:
    | {
        internalPrice?: unknown;
        externalPrice?: unknown;
        externalAcademicPrice?: unknown;
        externalMarketPrice?: unknown;
        externalNoSalaryPrice?: unknown;
        price?: unknown;
        pricing?:
          | {
              internal?: unknown;
              external?: unknown;
              externalAcademic?: unknown;
              externalMarket?: unknown;
              externalNoSalary?: unknown;
              legacy?: unknown;
            }
          | unknown;
      }
    | null
    | undefined,
  category?: CustomerCategory
): number | undefined {
  if (!input) return undefined;
  const pricing = input.pricing && typeof input.pricing === 'object' ? (input.pricing as any) : undefined;
  if (category === 'INTERNAL_CUSTOMERS') {
    const p = normalizePrice(pricing?.internal ?? input.internalPrice);
    if (p !== undefined) return p;
  } else if (category === 'EXTERNAL_CUSTOMER_ACADEMIC') {
    const p = normalizePrice(pricing?.externalAcademic ?? pricing?.external ?? input.externalAcademicPrice ?? input.externalPrice);
    if (p !== undefined) return p;
  } else if (category === 'EXTERNAL_CUSTOMER_MARKET') {
    const p = normalizePrice(pricing?.externalMarket ?? pricing?.external ?? input.externalMarketPrice ?? input.externalPrice);
    if (p !== undefined) return p;
  } else if (category === 'EXTERNAL_CUSTOMER_NO_SALARY') {
    const p = normalizePrice(pricing?.externalNoSalary ?? pricing?.external ?? input.externalNoSalaryPrice ?? input.externalPrice);
    if (p !== undefined) return p;
  }
  return normalizePrice(pricing?.legacy ?? input.price);
}

function resolveQty(rawValue: unknown): number | undefined {
  if (Array.isArray(rawValue)) {
    let sum = 0;
    let hasAny = false;
    for (const v of rawValue) {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n)) continue;
      hasAny = true;
      sum += n;
    }
    return hasAny ? sum : undefined;
  }
  const n = typeof rawValue === 'number' ? rawValue : typeof rawValue === 'string' && rawValue.trim() !== '' ? Number(rawValue) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function getMultiplier(parameters: unknown, rawFormData: unknown): number {
  const multiValueParamIds = getMultiValueParamIds(parameters);
  const formData = normalizeFormDataToArray(rawFormData, multiValueParamIds);
  const formDataMap = new Map(formData.map((entry) => [entry.id, entry.value]));

  let multiplier = 1;

  // Universal run count, read straight from formData: the UI injects it for every
  // service, so it is absent from service.parameters and the loop below cannot see it.
  const runCountQty = resolveQty(formDataMap.get(RUN_COUNT_PARAM_ID));
  if (runCountQty !== undefined) multiplier *= runCountQty;

  // Any further multiplier parameters the service declares for itself. The run count
  // is skipped here so a service that also declares it is not counted twice.
  if (Array.isArray(parameters)) {
    for (const param of parameters as ServiceParameterDefinition[]) {
      if (!param || typeof param !== 'object') continue;
      if (param.isPriceMultiplier !== true) continue;
      const id = typeof param.id === 'string' ? param.id : undefined;
      if (!id || id === RUN_COUNT_PARAM_ID) continue;

      const qty = resolveQty(formDataMap.get(id));
      if (qty === undefined) continue;
      multiplier *= qty;
    }
  }

  return multiplier;
}

/**
 * The universal run-count value for a node, if any — the same figure
 * getMultiplier folds into cost. Exposed separately so the Fee Schedule editor
 * can show staff what multiplier is baked into a line's total, since the
 * total itself doesn't say.
 */
export function extractRunCount(rawFormData: unknown): number | undefined {
  const formData = normalizeFormDataToArray(rawFormData, new Set());
  const entry = formData.find((e) => e.id === RUN_COUNT_PARAM_ID);
  return entry ? resolveQty(entry.value) : undefined;
}

export interface ServiceCostBreakdown {
  /** What one run of the service costs, before any multiplier parameter. */
  unitCost: number;
  /** What the multiplier parameters (the universal run count included) scale that by. */
  multiplier: number;
  /** What the line bills: unitCost x multiplier. */
  cost: number;
}

/**
 * The same figure `calculateServiceCost` returns, with the two numbers it was
 * built from. The Fee Schedule quotes all three ("$3.00 x 10 = $30.00"), and the
 * SOW editor edits the unit price rather than the total, so both have to be
 * stored rather than recovered by dividing — a unit price of 0 is legitimate.
 */
export function calculateServiceCostBreakdown(service: DampLabService, rawFormData: unknown, fallbackCost?: number, customerCategory?: CustomerCategory): ServiceCostBreakdown {
  const pricingMode = service.pricingMode ?? ServicePricingMode.SERVICE;
  let baseCost = 0;

  if (pricingMode === ServicePricingMode.PARAMETER) {
    // Parameter/option level pricing can also be category-specific; resolve inside calculateParameterCost.
    // To preserve the old signature, we pass category through by closing over it via resolveCategoryPrice below.
    baseCost = calculateParameterCostWithCategory(service.parameters, rawFormData, customerCategory);
  } else {
    const servicePrice = resolveCategoryPrice(
      {
        pricing: (service as any).pricing,
        internalPrice: (service as any).internalPrice,
        externalPrice: (service as any).externalPrice,
        price: service.price
      },
      customerCategory
    );
    if (servicePrice !== undefined) {
      baseCost = servicePrice;
    } else {
      const fallbackPrice = normalizePrice(fallbackCost);
      baseCost = fallbackPrice ?? 0;
    }
  }

  const raw = getMultiplier(service.parameters, rawFormData);
  const multiplier = Number.isFinite(raw) && raw > 0 ? raw : 1;
  return { unitCost: baseCost, multiplier, cost: baseCost * multiplier };
}

export function calculateServiceCost(service: DampLabService, rawFormData: unknown, fallbackCost?: number, customerCategory?: CustomerCategory): number {
  return calculateServiceCostBreakdown(service, rawFormData, fallbackCost, customerCategory).cost;
}

function calculateParameterCostWithCategory(parameters: unknown, rawFormData: unknown, customerCategory?: CustomerCategory): number {
  if (!Array.isArray(parameters)) return 0;

  const paramsById = new Map<string, ServiceParameterDefinition>();
  for (const param of parameters as ServiceParameterDefinition[]) {
    if (!param || typeof param !== 'object') continue;
    const id = typeof param.id === 'string' ? param.id : undefined;
    if (!id) continue;
    paramsById.set(id, param);
  }

  const multiValueParamIds = getMultiValueParamIds(parameters);
  const formData = normalizeFormDataToArray(rawFormData, multiValueParamIds);
  const formDataMap = new Map(formData.map((entry) => [entry.id, entry.value]));

  let total = 0;

  paramsById.forEach((param, id) => {
    const rawValue = formDataMap.get(id);
    const isMulti = multiValueParamIds.has(id) || Array.isArray(rawValue);

    const options = Array.isArray(param.options) ? param.options : undefined;
    const hasOptionPricing =
      typeof param.type === 'string' && (param.type === 'dropdown' || param.type === 'enum') && !!options && options.some((opt) => resolveCategoryPrice(opt, customerCategory) !== undefined);

    if (hasOptionPricing && options) {
      const valuesArray = Array.isArray(rawValue) ? rawValue : rawValue != null ? [rawValue] : [];

      for (const v of valuesArray) {
        if (v === null || v === undefined || v === '') continue;
        const optId = String(v);
        const opt = options.find((o) => typeof o.id === 'string' && o.id === optId);
        if (!opt) continue;
        const price = resolveCategoryPrice(opt, customerCategory);
        if (price === undefined) continue;
        total += price;
      }

      return;
    }

    const unitPrice = resolveCategoryPrice(param, customerCategory);
    if (unitPrice === undefined) return;

    let quantity = 0;
    if (isMulti) {
      if (Array.isArray(rawValue)) quantity = rawValue.length;
      else if (rawValue !== null && rawValue !== undefined) quantity = 1;
    } else if (rawValue !== null && rawValue !== undefined) {
      quantity = 1;
    }
    if (quantity === 0) return;

    total += unitPrice * quantity;
  });

  return total;
}
