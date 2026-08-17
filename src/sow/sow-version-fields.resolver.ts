import { Resolver, ResolveField, Parent } from '@nestjs/graphql';
import { SowVersion } from './sow-version.model';
import { SowVersionService } from './sow-version.service';

/**
 * Fields derived purely from a SowVersion's own data, needing no database
 * access. Kept separate from SOWResolver, which resolves fields of SOW itself.
 */
@Resolver(() => SowVersion)
export class SowVersionFieldsResolver {
  @ResolveField(() => String, { description: 'Human-facing label "<sent-count>.<sub-revision>", e.g. "1.2" — decoded from versionNumber.' })
  displayVersion(@Parent() version: SowVersion): string {
    return SowVersionService.displayVersionLabel(version.versionNumber);
  }
}
