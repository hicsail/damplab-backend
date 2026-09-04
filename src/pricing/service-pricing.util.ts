import { DampLabService, ServicePricingMode } from '../services/models/damplab-service.model';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../workflow/utils/form-data.util';
import { CustomerCategory } from './customer-category';

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
  name?: unknown;
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

export { CustomerCategory };

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

/**
 * THE category → price resolution, exported so the catalog view can quote a
 * caller their own price rather than shipping the whole tier table and letting the
 * browser pick. Do not write a second copy of this chain.
 */
export function resolveCategoryPrice(
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
  if (category === CustomerCategory.INTERNAL_CUSTOMERS) {
    const p = normalizePrice(pricing?.internal ?? input.internalPrice);
    if (p !== undefined) return p;
  } else if (category === CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC) {
    const p = normalizePrice(pricing?.externalAcademic ?? pricing?.external ?? input.externalAcademicPrice ?? input.externalPrice);
    if (p !== undefined) return p;
  } else if (category === CustomerCategory.EXTERNAL_CUSTOMER_MARKET) {
    const p = normalizePrice(pricing?.externalMarket ?? pricing?.external ?? input.externalMarketPrice ?? input.externalPrice);
    if (p !== undefined) return p;
  } else if (category === CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY) {
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

function getMultiplier(parameters: unknown, rawFormData: unknown, opts?: { skipSelfPriced?: boolean; customerCategory?: CustomerCategory }): number {
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

      // A parameter that carries its own price has already been billed as
      // `price x value` inside the base, so scaling the whole line by that same
      // value again would charge every other parameter for it too. See the
      // note on calculateParameterCostWithCategory.
      if (opts?.skipSelfPriced && resolveCategoryPrice(param, opts.customerCategory) !== undefined) continue;

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

/**
 * One priced element behind a parameter-priced line: which selection it was,
 * how many, at what rate.
 *
 * The figure a parameter-priced service quotes is a sum over selections, and
 * until now only the sum was kept. Both documents therefore printed an
 * unexplained total whenever the line had no multiplier to describe — which is
 * the normal case for option pricing. These rows are what let the Fee Schedule
 * and the invoice say what the customer actually chose.
 */
export interface ServicePricingDetail {
  /** The option or parameter name, as the customer picked it. */
  label: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface ServiceCostBreakdown {
  /** What one run of the service costs, before any multiplier parameter. */
  unitCost: number;
  /** What the multiplier parameters (the universal run count included) scale that by. */
  multiplier: number;
  /** What the line bills: unitCost x multiplier. */
  cost: number;
  /**
   * How unitCost was arrived at, for parameter-priced services. Absent — not
   * empty — for flat service pricing and for a line rebuilt from a fallback,
   * where there is nothing to itemise and an empty list would read as "priced
   * from nothing".
   */
  details?: ServicePricingDetail[];
}

/**
 * The same figure `calculateServiceCost` returns, with the two numbers it was
 * built from. The Fee Schedule quotes all three ("$3.00 x 10 = $30.00"), and the
 * SOW editor edits the unit price rather than the total, so both have to be
 * stored rather than recovered by dividing — a unit price of 0 is legitimate.
 */
export function calculateServiceCostBreakdown(
  service: DampLabService,
  rawFormData: unknown,
  fallbackCost?: number,
  customerCategory?: CustomerCategory,
  opts?: { fallbackLineCost?: number }
): ServiceCostBreakdown {
  const pricingMode = service.pricingMode ?? ServicePricingMode.SERVICE;
  let baseCost = 0;
  let details: ServicePricingDetail[] | undefined;

  // Computed before the base, because a line-total fallback has to be divided by
  // it to recover a unit price. Nothing about the multiplier depends on the base.
  const raw = getMultiplier(service.parameters, rawFormData, {
    // Only in PARAMETER mode do parameters carry prices of their own, so only
    // there can one have been billed into the base already. In SERVICE mode the
    // base is the service's own price and every multiplier parameter scales it.
    skipSelfPriced: pricingMode === ServicePricingMode.PARAMETER,
    customerCategory
  });
  const multiplier = Number.isFinite(raw) && raw > 0 ? raw : 1;

  /**
   * The price to fall back on when the service record cannot be priced.
   *
   * `fallbackCost` is a *unit* price. `opts.fallbackLineCost` is a line total —
   * what a workflow node already computed, multiplier included — so it has to be
   * divided back down before it is used in the unit position. Feeding a total in
   * as a unit price is what made a catalogue-priceless service with a run count
   * of N bill `unit x N x N`.
   */
  const fallbackUnitCost = (): number | undefined => {
    const unit = normalizePrice(fallbackCost);
    if (unit !== undefined) return unit;
    const line = normalizePrice(opts?.fallbackLineCost);
    if (line === undefined) return undefined;
    return multiplier > 0 ? line / multiplier : line;
  };

  if (pricingMode === ServicePricingMode.PARAMETER) {
    // With no parameter values to price, there is nothing to compute from, and
    // the honest answer is the price the caller already holds — not zero. This
    // branch used to have no fallback at all, so a parameter-priced line whose
    // formData did not reach us silently repriced to $0 and billed nothing,
    // discarding the figure the canvas computed and the customer was quoted.
    //
    // Deliberately keyed on "no values at all", not on "the total came out 0":
    // a genuine zero is a real price and must survive. Falling back on that
    // instead would mask it.
    //
    // The frontend twin (damplab-ui/src/utils/servicePricing.ts) is deliberately
    // NOT given this branch, despite the standing warning about those copies
    // drifting. It prices the canvas, where empty parameters mean "nothing
    // chosen yet" and there is no prior figure worth preserving — zero is the
    // right answer there. This branch exists for the opposite case: rebuilding a
    // line that was already priced. Nothing compares the two figures (the SOW's
    // pricing check is an internal baseCost/adjustments/totalCost consistency
    // check, not a client-vs-server one), so the two cannot disagree into a
    // failed save.
    const hasParameterValues = normalizeFormDataToArray(rawFormData, getMultiValueParamIds(service.parameters)).length > 0;
    if (hasParameterValues) {
      const priced = calculateParameterCostWithCategory(service.parameters, rawFormData, customerCategory);
      baseCost = priced.total;
      // Left undefined rather than empty when nothing was priced: an empty list
      // would read as "itemised, and it came to nothing".
      if (priced.details.length > 0) details = priced.details;
    } else {
      baseCost = fallbackUnitCost() ?? 0;
    }
  } else {
    // The whole service, not a hand-picked subset of its price fields.
    //
    // This used to build `{ pricing, internalPrice, externalPrice, price }`,
    // which silently omitted `externalAcademicPrice`, `externalMarketPrice` and
    // `externalNoSalaryPrice` — three of the five fields resolveCategoryPrice
    // knows how to read. A service whose tiers lived only in those deprecated
    // flat fields (every service not yet re-saved through AdminEditService)
    // therefore resolved all three external tiers to `legacy`: the pricing
    // category had no effect on operation-priced lines at all. Option and
    // parameter pricing never had the bug because they pass their whole object.
    const servicePrice = resolveCategoryPrice(service as any, customerCategory);
    baseCost = servicePrice !== undefined ? servicePrice : fallbackUnitCost() ?? 0;
  }

  return { unitCost: baseCost, multiplier, cost: baseCost * multiplier, details };
}

export function calculateServiceCost(service: DampLabService, rawFormData: unknown, fallbackCost?: number, customerCategory?: CustomerCategory): number {
  return calculateServiceCostBreakdown(service, rawFormData, fallbackCost, customerCategory).cost;
}

/**
 * What the selected parameter values cost, and the rows explaining it.
 *
 * Three kinds of parameter are priced here:
 *
 *  - **option-priced** dropdowns/enums — each selected option adds its own price;
 *  - **multiplier parameters that carry a price** — billed `price x value`, so a
 *    $40/hr parameter set to 3 adds $120. These are excluded from the line's
 *    global multiplier (see getMultiplier): scaling the whole line by the hours
 *    would charge every *other* parameter for them as well, which is how a
 *    $100 instrument plus $40/hr for 3 hours used to come to $420 instead of
 *    $220. Unflagging the parameter was no better — it billed a flat $140
 *    however many hours were entered, because "quantity" below counts selected
 *    values rather than reading the number;
 *  - **everything else priced** — `price x (number of values selected)`.
 */
function calculateParameterCostWithCategory(parameters: unknown, rawFormData: unknown, customerCategory?: CustomerCategory): { total: number; details: ServicePricingDetail[] } {
  if (!Array.isArray(parameters)) return { total: 0, details: [] };

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
  const details: ServicePricingDetail[] = [];

  const record = (label: string, quantity: number, unitPrice: number): void => {
    const lineTotal = unitPrice * quantity;
    total += lineTotal;
    details.push({ label, quantity, unitPrice, total: lineTotal });
  };

  paramsById.forEach((param, id) => {
    const rawValue = formDataMap.get(id);
    const isMulti = multiValueParamIds.has(id) || Array.isArray(rawValue);
    const paramLabel = typeof param.name === 'string' && param.name.trim() !== '' ? param.name : id;

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
        const optLabel = typeof opt.name === 'string' && opt.name.trim() !== '' ? opt.name : optId;
        record(`${paramLabel}: ${optLabel}`, 1, price);
      }

      return;
    }

    const unitPrice = resolveCategoryPrice(param, customerCategory);
    if (unitPrice === undefined) return;

    // A priced multiplier reads its number rather than counting it: "8" hours at
    // $40 is $320, not one selection at $40.
    if (param.isPriceMultiplier === true && id !== RUN_COUNT_PARAM_ID) {
      const qty = resolveQty(rawValue);
      if (qty === undefined || qty === 0) return;
      record(paramLabel, qty, unitPrice);
      return;
    }

    let quantity = 0;
    if (isMulti) {
      if (Array.isArray(rawValue)) quantity = rawValue.length;
      else if (rawValue !== null && rawValue !== undefined) quantity = 1;
    } else if (rawValue !== null && rawValue !== undefined) {
      quantity = 1;
    }
    if (quantity === 0) return;

    record(paramLabel, quantity, unitPrice);
  });

  return { total, details };
}
