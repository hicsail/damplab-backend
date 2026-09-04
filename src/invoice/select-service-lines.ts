import { BadRequestException } from '@nestjs/common';

/**
 * Which SOW lines an invoice bills.
 *
 * A job can use the same catalog service more than once — two PCR nodes with
 * different parameters are two lines with different prices and the same
 * `serviceId`. Selection used to be a list of service ids resolved through a
 * `Map` keyed on that id, so the second line overwrote the first: picking both
 * billed the last one twice, and the subtotal came out `2 x cost₂` instead of
 * `cost₁ + cost₂`. Service ids do not identify lines, so nothing keyed on them
 * ever could.
 *
 * Position does identify them, which is why `services` is the real contract:
 * each entry names the line's index in the billing source and the `serviceId`
 * expected there. The id is not redundant — it is what catches the array having
 * moved between the dialog being filled in and submitted, which a workflow edit
 * re-syncing the SOW can do at any time.
 */

/** One line the caller picked: where it sits, and what they believed was there. */
export interface ServiceLineSelection {
  index: number;
  serviceId: string;
}

export interface ServiceLineSelectionInput {
  services?: ServiceLineSelection[] | null;
  serviceIds?: string[] | null;
}

function lineServiceId(line: { serviceId?: unknown; _id?: unknown }): string {
  return String(line?.serviceId ?? line?._id ?? '');
}

/**
 * Resolves `services` positionally, refusing anything it cannot place exactly.
 *
 * Every refusal here used to be a silent mis-bill: an out-of-range index fell
 * through `filter(Boolean)` and simply vanished from the invoice, and a shifted
 * array billed whatever now sat at that position under the old line's name.
 */
function selectByPosition<T extends { serviceId?: unknown; _id?: unknown }>(lines: T[], selections: ServiceLineSelection[]): T[] {
  const seen = new Set<number>();
  return selections.map(({ index, serviceId }) => {
    if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
      throw new BadRequestException(`Service line ${index} is no longer part of this Statement of Work. Reload the job and select the services again.`);
    }
    if (seen.has(index)) {
      throw new BadRequestException(`Service line ${index} was selected more than once.`);
    }
    seen.add(index);

    const line = lines[index];
    if (lineServiceId(line) !== String(serviceId)) {
      throw new BadRequestException('The services on this Statement of Work changed while the invoice was being prepared. Reload the job and select the services again.');
    }
    return line;
  });
}

/**
 * The pre-positional contract, kept working for one deploy.
 *
 * The backend ships before the UI does, so a new server briefly serves a client
 * that still sends bare service ids. This resolves them as a multiset — each id
 * consumes the next line not already taken — which at least stops duplicates
 * collapsing onto one line.
 *
 * It is a best effort, not a correct one: the old client derives its ids from
 * the SOW's live billing core, and an invoice bills the version frozen with the
 * customer. When those two have drifted, order is not guaranteed to line up and
 * there is no way to tell from ids alone. Delete this branch once the UI that
 * sends `services` is deployed everywhere.
 */
function selectByServiceId<T extends { serviceId?: unknown; _id?: unknown }>(lines: T[], serviceIds: string[]): T[] {
  const remaining = lines.map((line, index) => ({ line, index, id: lineServiceId(line) }));
  const taken = new Set<number>();

  return serviceIds.map((wanted) => {
    const match = remaining.find((candidate) => candidate.id === String(wanted) && !taken.has(candidate.index));
    if (!match) {
      throw new BadRequestException(`No unbilled service line matching ${wanted} was found on this Statement of Work.`);
    }
    taken.add(match.index);
    return match.line;
  });
}

export function selectServiceLines<T extends { serviceId?: unknown; _id?: unknown }>(lines: T[], input: ServiceLineSelectionInput): T[] {
  const services = input.services ?? [];
  const serviceIds = input.serviceIds ?? [];

  if (services.length > 0 && serviceIds.length > 0) {
    throw new BadRequestException('Provide either services or serviceIds, not both.');
  }
  if (services.length === 0 && serviceIds.length === 0) {
    throw new BadRequestException('Select at least one service to invoice.');
  }
  if (lines.length === 0) {
    throw new BadRequestException('This Statement of Work has no service lines to invoice.');
  }

  return services.length > 0 ? selectByPosition(lines, services) : selectByServiceId(lines, serviceIds);
}
