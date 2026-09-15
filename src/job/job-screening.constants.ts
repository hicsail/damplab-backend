/**
 * Catalog `name` values from `scripts/src/assets/services.json`. Matching is by
 * name because the JSON `id` ("gibson-assembly", "m-cloning") is not stored in
 * Mongo — only the name survives seeding.
 */
export const GIBSON_ASSEMBLY_SERVICE_NAME = 'Gibson Assembly';
export const M_CLONING_SERVICE_NAME = 'Modular Cloning';

/**
 * Which form fields carry a customer-supplied sequence, per service.
 *
 * Gibson's `vector` and `plasmid-map` are file uploads, not text, so only the
 * insert is screenable without parsing attachments. Modular Cloning takes both
 * as strings.
 */
export const SCREENED_FIELDS_BY_SERVICE: ReadonlyMap<string, readonly string[]> = new Map([
  [GIBSON_ASSEMBLY_SERVICE_NAME, ['insert'] as const],
  [M_CLONING_SERVICE_NAME, ['vector', 'insert'] as const]
]);
