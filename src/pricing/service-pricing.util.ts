import { DampLabService, ServicePricingMode } from '../services/models/damplab-service.model';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../workflow/utils/form-data.util';

interface ServiceParameterDefinition {
  id?: unknown;
  allowMultipleValues?: boolean;
  price?: unknown;
}

function normalizePrice(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buildParameterPriceMap(parameters: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(parameters)) return map;

  for (const param of parameters as ServiceParameterDefinition[]) {
    if (!param || typeof param !== 'object') continue;
    const id = typeof param.id === 'string' ? param.id : undefined;
    if (!id) continue;
    const price = normalizePrice(param.price);
    if (price !== undefined) {
      map.set(id, price);
    }
  }

  return map;
}

function countValue(value: unknown, isMulti: boolean): number {
  if (isMulti) {
    if (Array.isArray(value)) return value.length;
    if (value === null || value === undefined) return 0;
    return 1;
  }
  return value === null || value === undefined ? 0 : 1;
}

function calculateParameterCost(parameters: unknown, rawFormData: unknown): number {
  const priceMap = buildParameterPriceMap(parameters);
  if (priceMap.size === 0) return 0;

  const multiValueParamIds = getMultiValueParamIds(parameters);
  const formData = normalizeFormDataToArray(rawFormData, multiValueParamIds);
  const formDataMap = new Map(formData.map((entry) => [entry.id, entry.value]));

  let total = 0;
  for (const [id, unitPrice] of priceMap) {
    const value = formDataMap.get(id);
    const count = countValue(value, multiValueParamIds.has(id));
    total += unitPrice * count;
  }

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
