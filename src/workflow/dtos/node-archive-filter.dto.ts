import { registerEnumType } from '@nestjs/graphql';

/**
 * Which archive bucket a lab-monitor board query should return. Defaults to ACTIVE.
 *
 * Modelled on `JobArchiveFilter` (`job/dto/jobs-query.dto.ts`) rather than reusing
 * it: the two are the same shape today but describe different objects, and a shared
 * enum would tie the board's filter options to the jobs dashboard's forever.
 */
export enum NodeArchiveFilter {
  /** Only cards that are not archived — the board's default view. */
  ACTIVE = 'ACTIVE',
  /** Only archived cards. */
  ARCHIVED = 'ARCHIVED',
  /** Both, ignoring archive status. */
  ALL = 'ALL'
}
registerEnumType(NodeArchiveFilter, { name: 'NodeArchiveFilter' });

/**
 * The Mongo clause for a filter. `$ne: true` rather than `false`, because every
 * card that predates the flag has no `isArchived` field at all and must count as
 * active.
 */
export function archiveQuery(filter: NodeArchiveFilter): Record<string, unknown> {
  if (filter === NodeArchiveFilter.ARCHIVED) return { isArchived: true };
  if (filter === NodeArchiveFilter.ALL) return {};
  return { isArchived: { $ne: true } };
}
