/**
 * The one rule an equipment-use operation has to satisfy: it must actually require
 * a piece of equipment somebody can book. Kept pure and free of Nest/Mongo so both
 * the create path (which sees the whole payload) and the update path (which has to
 * merge a partial onto the stored record) can call it with what they already hold.
 */
export const EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE = 'An equipment-use operation needs at least one bookable inventory item in Required inventory.';

const idOf = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const s = String(value);
  return s === '' || s === '[object Object]' ? undefined : s;
};

export function equipmentUseRuleViolation(
  equipmentUse: boolean | undefined,
  requirementIds: ReadonlyArray<unknown> | undefined,
  bookableItems: ReadonlyArray<{ _id?: unknown; id?: unknown; bookable?: boolean }>
): string | undefined {
  if (equipmentUse !== true) return undefined;

  const required = new Set((requirementIds ?? []).map(idOf).filter((v): v is string => v !== undefined));
  if (required.size === 0) return EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE;

  const hasBookable = bookableItems.some((item) => {
    if (item?.bookable !== true) return false;
    const id = idOf(item._id) ?? idOf(item.id);
    return id !== undefined && required.has(id);
  });

  return hasBookable ? undefined : EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE;
}
