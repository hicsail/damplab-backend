import { DampLabService, ServicePricingMode } from '../services/models/damplab-service.model';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../workflow/utils/form-data.util';

interface ServiceParameterOption {
  id?: unknown;
  name?: unknown;
  price?: unknown;
}

interface ServiceParameterDefinition {
  id?: unknown;
  allowMultipleValues?: boolean;
  price?: unknown;
  type?: unknown;
  options?: ServiceParameterOption[] | unknown;
}

function normalizePrice(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
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
      options.some((opt) => normalizePrice(opt.price) !== undefined);

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
        const price = normalizePrice(opt.price);
        if (price === undefined) continue;
        total += price;
      }

      return;
    }

    // Fallback: parameter-level pricing using per-parameter price and count of values.
    const unitPrice = normalizePrice(param.price);
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

export function calculateServiceCost(service: DampLabService, rawFormData: unknown, fallbackCost?: number): number {
  const pricingMode = service.pricingMode ?? ServicePricingMode.SERVICE;
  if (pricingMode === ServicePricingMode.PARAMETER) {
    return calculateParameterCost(service.parameters, rawFormData);
  }

  const servicePrice = normalizePrice(service.price);
  if (servicePrice !== undefined) {
    return servicePrice;
  }

  const fallbackPrice = normalizePrice(fallbackCost);
  return fallbackPrice ?? 0;
}
