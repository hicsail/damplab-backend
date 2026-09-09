import { EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE, equipmentUseRuleViolation } from './equipment-use.validation';

const bookable = (id: string): { _id: string; bookable: boolean } => ({ _id: id, bookable: true });
const notBookable = (id: string): { _id: string; bookable: boolean } => ({ _id: id, bookable: false });

describe('equipmentUseRuleViolation', () => {
  it('passes an equipment-use service that requires a bookable item', () => {
    expect(equipmentUseRuleViolation(true, ['a', 'b'], [notBookable('a'), bookable('b')])).toBeUndefined();
  });

  it('rejects an equipment-use service whose required items are none of them bookable', () => {
    expect(equipmentUseRuleViolation(true, ['a'], [notBookable('a')])).toBe(EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE);
  });

  it('rejects an equipment-use service that requires no inventory at all', () => {
    expect(equipmentUseRuleViolation(true, [], [])).toBe(EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE);
    expect(equipmentUseRuleViolation(true, undefined, [])).toBe(EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE);
  });

  it('never checks inventory when the flag is off or absent', () => {
    expect(equipmentUseRuleViolation(false, [], [])).toBeUndefined();
    expect(equipmentUseRuleViolation(undefined, [], [])).toBeUndefined();
  });

  it('matches ids across the ObjectId/string boundary', () => {
    // requirementIds arrive as ObjectIds from Mongo and as strings from GraphQL.
    expect(equipmentUseRuleViolation(true, [{ toString: (): string => 'a' }], [bookable('a')])).toBeUndefined();
    expect(equipmentUseRuleViolation(true, ['a'], [{ id: 'a', bookable: true }])).toBeUndefined();
  });

  it('ignores a bookable item the service does not actually require', () => {
    expect(equipmentUseRuleViolation(true, ['a'], [notBookable('a'), bookable('z')])).toBe(EQUIPMENT_USE_NEEDS_BOOKABLE_MESSAGE);
  });
});
