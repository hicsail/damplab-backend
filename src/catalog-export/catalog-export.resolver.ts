import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import JSON from 'graphql-type-json';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { CatalogExportService } from './catalog-export.service';

@Resolver()
@UseGuards(AuthRolesGuard)
export class CatalogExportResolver {
  // Named `exportService`, not `catalogExport` — the latter would clash with
  // the `catalogExport` query method below (TS2300) and shadow it.
  constructor(private readonly exportService: CatalogExportService) {}

  @Query(() => JSON, { description: 'The whole catalog as seed-shaped JSON (services, categories, bundles, parameterSets, inventory, sowSections, exportedAt). Download only.' })
  @RequirePermission(Permission.CatalogEditorWrite)
  catalogExport(): Promise<unknown> {
    return this.exportService.export();
  }
}
