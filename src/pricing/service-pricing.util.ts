import { DampLabService, ServicePricingMode } from '../services/models/damplab-service.model';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../workflow/utils/form-data.util';

interface ServiceParameterOption {
  id?: unknown;
  name?: unknown;
  price?: unknown;
  internalPrice?: unknown;
  externalPrice?: unknown;
  pricing?: { internal?: unknown; external?: unknown; legacy?: unknown } | unknown;
}

interface ServiceParameterDefinition {
  id?: unknown;
  allowMultipleValues?: boolean;
  price?: unknown;
  internalPrice?: unknown;
  externalPrice?: unknown;
  pricing?: { internal?: unknown; external?: unknown; legacy?: unknown } | unknown;
  type?: unknown;
  options?: ServiceParameterOption[] | unknown;
  isPriceMultiplier?: boolean;
}

export type CustomerCategory = 'INTERNAL' | 'EXTERNAL';

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
        price?: unknown;
        pricing?: { internal?: unknown; external?: unknown; legacy?: unknown } | unknown;
      }
    | null
    | undefined,
  category?: CustomerCategory
): number | undefined {
  if (!input) return undefined;
  const pricing = input.pricing && typeof input.pricing === 'object' ? (input.pricing as any) : undefined;
  if (category === 'INTERNAL') {
    const p = normalizePrice(pricing?.internal ?? input.internalPrice);
    if (p !== undefined) return p;
  } else if (category === 'EXTERNAL') {
    const p = normalizePrice(pricing?.external ?? input.externalPrice);
    if (p !== undefined) return p;
  }
  return normalizePrice(pricing?.legacy ?? input.price);
}

function calculateParameterCost(parameters: unknown, rawFormData: unknown): number {
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
      typeof param.type === 'string' &&
      (param.type === 'dropdown' || param.type === 'enum') &&
      !!options &&
      options.some((opt) => resolveCategoryPrice(opt, undefined) !== undefined);

    // When dropdown options have prices, use option-level pricing.
    if (hasOptionPricing && options) {
      const valuesArray = Array.isArray(rawValue)
        ? rawValue
        : rawValue != null
        ? [rawValue]
        : [];

      for (const v of valuesArray) {
        if (v === null || v === undefined || v === '') continue;
        const optId = String(v);
        const opt = options.find((o) => typeof o.id === 'string' && o.id === optId);
        if (!opt) continue;
        const price = resolveCategoryPrice(opt, undefined);
        if (price === undefined) continue;
        total += price;
      }

      return;
    }

    // Fallback: parameter-level pricing using per-parameter price and count of values.
    const unitPrice = resolveCategoryPrice(param, undefined);
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

function getMultiplier(parameters: unknown, rawFormData: unknown): number {
  if (!Array.isArray(parameters)) return 1;

  const multiValueParamIds = getMultiValueParamIds(parameters);
  const formData = normalizeFormDataToArray(rawFormData, multiValueParamIds);
  const formDataMap = new Map(formData.map((entry) => [entry.id, entry.value]));

  let multiplier = 1;

  for (const param of parameters as ServiceParameterDefinition[]) {
    if (!param || typeof param !== 'object') continue;
    if (param.isPriceMultiplier !== true) continue;
    const id = typeof param.id === 'string' ? param.id : undefined;
    if (!id) continue;

    const rawValue = formDataMap.get(id);
    if (rawValue === null || rawValue === undefined) continue;

    let qty: number | undefined;

    if (Array.isArray(rawValue)) {
      let sum = 0;
      let hasAny = false;
      for (const v of rawValue) {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
        if (!Number.isFinite(n)) continue;
        hasAny = true;
        sum += n;
      }
      qty = hasAny ? sum : undefined;
    } else {
      const n =
        typeof rawValue === 'number'
          ? rawValue
          : typeof rawValue === 'string' && rawValue.trim() !== ''
          ? Number(rawValue)
          : NaN;
      qty = Number.isFinite(n) ? n : undefined;
    }

    if (qty === undefined) continue;
    multiplier *= qty;
  }

  return multiplier;
}

export function calculateServiceCost(
  service: DampLabService,
  rawFormData: unknown,
  fallbackCost?: number,
  customerCategory?: CustomerCategory
): number {
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

  const multiplier = getMultiplier(service.parameters, rawFormData);
  return baseCost * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);
}

function calculateParameterCostWithCategory(
  parameters: unknown,
  rawFormData: unknown,
  customerCategory?: CustomerCategory
): number {
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
      typeof param.type === 'string' &&
      (param.type === 'dropdown' || param.type === 'enum') &&
      !!options &&
      options.some((opt) => resolveCategoryPrice(opt, customerCategory) !== undefined);

    if (hasOptionPricing && options) {
      const valuesArray = Array.isArray(rawValue)
        ? rawValue
        : rawValue != null
          ? [rawValue]
          : [];

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
