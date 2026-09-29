/**
 * An operation's *effective* parameters: its own, then every Parameter Set's in
 * `parameterSetIds` order. One function so the canvas, pricing, SOW repricing,
 * form-data normalisation, sample sheets, screening and the agent cannot disagree
 * about what an operation asks for. Pure — the loaders fetch the sets.
 */
export interface ParameterSetLike {
  _id: unknown;
  name: string;
  parameters?: unknown;
}

export interface ParameterSetClash {
  parameterId: string;
  firstSet: string;
  secondSet: string;
}

export const PROVENANCE_KEYS = ['fromParameterSetId', 'fromParameterSetName'] as const;

const isParam = (p: unknown): p is Record<string, any> => !!p && typeof p === 'object' && !Array.isArray(p);

const withoutKeys = (p: Record<string, any>, keys: readonly string[]): Record<string, any> => {
  const copy = { ...p };
  for (const key of keys) delete copy[key];
  return copy;
};

export function setsByIdMap(sets: ReadonlyArray<ParameterSetLike>): Map<string, ParameterSetLike> {
  return new Map(sets.map((set) => [String(set._id), set] as const));
}

export function effectiveParameters(service: { parameters?: unknown; parameterSetIds?: ReadonlyArray<unknown> | null }, setsById: ReadonlyMap<string, ParameterSetLike>): any[] {
  const own = Array.isArray(service.parameters) ? service.parameters : [];
  const result: any[] = [...own];
  const taken = new Set<string>(own.filter(isParam).map((p) => String(p.id)));
  for (const rawId of service.parameterSetIds ?? []) {
    const set = setsById.get(String(rawId));
    if (!set || !Array.isArray(set.parameters)) continue;
    for (const p of set.parameters) {
      if (!isParam(p)) continue;
      const id = String(p.id);
      // The operation's own parameter wins; a second set cannot re-add an id
      // either (a clash is refused on save, this is the read-side belt).
      if (taken.has(id)) continue;
      taken.add(id);
      result.push({
        ...withoutKeys(p, ['paramGroupId', ...PROVENANCE_KEYS]),
        allowMultipleValues: p.allowMultipleValues === true,
        fromParameterSetId: String(set._id),
        fromParameterSetName: set.name
      });
    }
  }
  return result;
}

/**
 * What a write stores as the operation's own list. A client that echoes back the
 * effective list (an old browser tab, a script) would otherwise copy every set
 * parameter onto the operation and freeze it there.
 */
export function stripSetDerivedParameters<T>(parameters: T): T {
  if (!Array.isArray(parameters)) return parameters;
  return parameters.filter((p) => !(isParam(p) && p.fromParameterSetId)).map((p) => (isParam(p) ? withoutKeys(p, PROVENANCE_KEYS) : p)) as unknown as T;
}

export function findParameterSetClashes(sets: ReadonlyArray<ParameterSetLike>): ParameterSetClash[] {
  const firstSeen = new Map<string, string>();
  const clashes: ParameterSetClash[] = [];
  for (const set of sets) {
    const idsInThisSet = new Set<string>();
    for (const p of Array.isArray(set.parameters) ? set.parameters : []) {
      if (!isParam(p)) continue;
      const id = String(p.id);
      if (idsInThisSet.has(id)) continue;
      idsInThisSet.add(id);
      const owner = firstSeen.get(id);
      if (owner !== undefined && owner !== set.name) clashes.push({ parameterId: id, firstSet: owner, secondSet: set.name });
      else if (owner === undefined) firstSeen.set(id, set.name);
    }
  }
  return clashes;
}

export function clashMessage(clash: ParameterSetClash): string {
  return `Parameter id "${clash.parameterId}" is in both "${clash.firstSet}" and "${clash.secondSet}".`;
}
