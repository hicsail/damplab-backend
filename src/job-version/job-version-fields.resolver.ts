import { Resolver, ResolveField, Parent } from '@nestjs/graphql';
import { JobVersion } from './job-version.model';
import { JobVersionService } from './job-version.service';

@Resolver(() => JobVersion)
export class JobVersionFieldsResolver {
  @ResolveField(() => String, {
    description: 'Human-facing label: "1.2" for encoded numbers, "3" for pre-scheme integers.'
  })
  displayVersion(@Parent() version: JobVersion): string {
    return JobVersionService.displayVersionLabel(version.versionNumber);
  }
}
