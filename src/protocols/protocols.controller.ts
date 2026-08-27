import { Controller, ForbiddenException, Get, Param, UseGuards } from '@nestjs/common';
import { AuthRolesGuard } from '../auth/auth.guard';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission } from '../auth/permissions/permissions';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { ProtocolsService, ProtocolView } from './protocols.service';

/**
 * Read proxy for protocols.io. The API token lives server-side (config) and is
 * never exposed to the browser.
 *
 * Two surfaces reach it, and they hold *different* permissions: the technician
 * bench renders a service's linked protocol inline (`bench:use`, which the matrix
 * amendment now also gives equipment users), and the Protocol Library renders the
 * same content (`protocol-library:read`). `@RequirePermission` requires *all* the
 * permissions it lists, so the either/or is an inline check rather than a
 * decoration. Leaving the previous `@Roles(Role.DamplabStaff)` in place would have
 * left both of those pages 403ing on protocol content.
 */
@Controller('api/protocols')
@UseGuards(AuthRolesGuard)
export class ProtocolsController {
  constructor(private readonly protocolsService: ProtocolsService) {}

  /** GET /api/protocols/:id — id is a protocols.io short slug or numeric id. */
  @Get(':id')
  async getProtocol(@Param('id') id: string, @CurrentUser() user: User): Promise<ProtocolView> {
    if (!hasPermission(user, Permission.BenchUse) && !hasPermission(user, Permission.ProtocolLibraryRead)) {
      throw new ForbiddenException('Missing permission: bench:use or protocol-library:read');
    }
    return this.protocolsService.getProtocol(id);
  }
}
