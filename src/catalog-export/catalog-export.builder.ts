/**
 * The whole catalog as one JSON document, for staff to archive.
 *
 * `services`, `categories` and `bundles` are a *superset* of the seed-file shape
 * the reset module's `loadData` takes: every ServiceInput/CategoryInput/BundleInput
 * key is here with the same meaning (string ids, cross-references by those ids),
 * plus pricing, Parameter Set ids and the hidden flag. It is an archive, not a
 * `loadData` payload — that input is strict and has no Parameter Sets.
 * Soft-deleted operations are not included (their ids come from `findAll`).
 */
export interface CatalogExportInput {
  services: any[];
  categories: any[];
  bundles: any[];
  parameterSets: any[];
  inventory: any[];
  sowPresets: any[];
  now: Date;
}

export interface CatalogExport {
  services: Record<string, unknown>[];
  categories: Array<{ id: string; label: string }>;
  bundles: Array<{ id: string; label: string; icon: string; services: string[] }>;
  parameterSets: Array<{ id: string; name: string; description: string | null; parameters: any[] }>;
  inventory: Record<string, unknown>[];
  sowSections: Array<{ sectionKey: string; name: string; text: string; order: number }>;
  exportedAt: string;
}

const plain = (doc: any): any => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
/** A raw ObjectId's `.id` is its 12-byte buffer, so ObjectIds are stringified directly, never via `.id`. */
const idString = (v: any): string => (v && typeof v === 'object' && typeof v.toHexString === 'function' ? v.toHexString() : String(v?._id ?? v?.id ?? v));
const idOf = (doc: any): string => idString(doc?._id ?? doc?.id);
const ids = (list: unknown): string[] => (Array.isArray(list) ? list.map(idString) : []);

export function buildCatalogExport(input: CatalogExportInput): CatalogExport {
  const serviceIds = new Set(input.services.map(idOf));
  const inExport = (list: unknown): string[] => ids(list).filter((id) => serviceIds.has(id));
  const categoriesFor = (serviceId: string): string[] => input.categories.filter((c) => ids(c.services).includes(serviceId)).map(idOf);

  const services = input.services.map((s) => {
    const id = idOf(s);
    return {
      // Seed ServiceInput keys.
      id,
      name: s.name,
      icon: s.icon ?? '',
      price: s.price ?? null,
      pricingMode: s.pricingMode ?? 'SERVICE',
      parameters: Array.isArray(s.ownParameters) ? s.ownParameters : Array.isArray(s.parameters) ? s.parameters : [],
      allowedConnections: inExport(s.allowedConnections),
      categories: categoriesFor(id),
      result: s.result ?? null,
      description: s.description ?? '',
      resultParams: s.resultParams ?? [],
      paramGroups: s.paramGroups ?? [],
      // Superset.
      serviceCategoryNumber: s.serviceCategoryNumber ?? null,
      serviceCategoryName: s.serviceCategoryName ?? null,
      unit: s.unit ?? null,
      pricing: plain(s.pricing) ?? null,
      internalPrice: s.internalPrice ?? null,
      externalPrice: s.externalPrice ?? null,
      externalAcademicPrice: s.externalAcademicPrice ?? null,
      externalMarketPrice: s.externalMarketPrice ?? null,
      externalNoSalaryPrice: s.externalNoSalaryPrice ?? null,
      allowMultipleRuns: s.allowMultipleRuns === true,
      equipmentUse: s.equipmentUse === true,
      deliverables: s.deliverables ?? [],
      notes: s.notes ?? null,
      protocolIds: s.protocolIds ?? [],
      inventoryRequirements: ids(s.inventoryRequirements),
      parameterSetIds: ids(s.parameterSetIds),
      hiddenFromClients: s.hiddenFromClients === true
    };
  });

  return {
    services,
    categories: input.categories.map((c) => ({ id: idOf(c), label: c.label })),
    bundles: input.bundles.map((b) => ({ id: idOf(b), label: b.label, icon: b.icon ?? '', services: inExport(b.services) })),
    parameterSets: input.parameterSets.map((p) => ({ id: idOf(p), name: p.name, description: p.description ?? null, parameters: Array.isArray(p.parameters) ? p.parameters : [] })),
    inventory: input.inventory.map((item) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _id, __v, ...rest } = plain(item);
      return { id: idString(_id ?? item.id), ...rest };
    }),
    sowSections: input.sowPresets.map((t) => ({ sectionKey: t.sectionKey, name: t.name, text: t.text ?? '', order: t.order ?? 0 })),
    exportedAt: input.now.toISOString()
  };
}
