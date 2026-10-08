import { BadRequestException } from '@nestjs/common';
import { parameterDefinitionError } from '../services/parameter-validation';
import { conditionDefinitionError } from '../services/parameter-conditions';
import { PROVENANCE_KEYS } from '../services/effective-parameters';

export function normalizeSetName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw new BadRequestException('A parameter set needs a name.');
  if (name.includes(';')) throw new BadRequestException('A parameter set name cannot contain ";" — the operations spreadsheet uses it to separate set names.');
  return name;
}

/** paramGroupId is never stored on a set; the provenance keys mark set-derived parameters and never originate here. */
const DROPPED_KEYS: readonly string[] = ['paramGroupId', ...PROVENANCE_KEYS];

export function normalizeSetParameters(raw: unknown): any[] {
  if (!Array.isArray(raw)) throw new BadRequestException('parameters must be a list.');
  const seen = new Set<string>();
  const parameters = raw.map((p, i) => {
    if (!p || typeof p !== 'object' || typeof (p as any).id !== 'string' || !(p as any).id.trim()) {
      throw new BadRequestException(`Parameter ${i + 1} has no id.`);
    }
    const id = (p as any).id.trim();
    if (seen.has(id)) throw new BadRequestException(`Parameter id "${id}" appears twice in this set.`);
    seen.add(id);
    const copy: Record<string, unknown> = { ...(p as Record<string, unknown>), id };
    for (const key of DROPPED_KEYS) delete copy[key];
    const error = parameterDefinitionError(copy);
    if (error) throw new BadRequestException(error);
    return copy;
  });
  // Against the whole list as it will be stored: a loop needs every member's condition.
  for (const parameter of parameters) {
    const error = conditionDefinitionError(parameter, parameters);
    if (error) throw new BadRequestException(error);
  }
  return parameters;
}
