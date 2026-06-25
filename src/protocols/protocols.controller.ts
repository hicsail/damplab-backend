import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';
import { ProtocolsService, ProtocolView } from './protocols.service';

/**
 * Staff-only read proxy for protocols.io. The API token lives server-side
 * (config) and is never exposed to the browser. Used by the technician bench
 * view to render a service's linked protocol inline.
 */
@Controller('api/protocols')
@UseGuards(AuthRolesGuard)
@Roles(Role.DamplabStaff)
export class ProtocolsController {
  constructor(private readonly protocolsService: ProtocolsService) {}

  /** GET /api/protocols/:id — id is a protocols.io short slug or numeric id. */
  @Get(':id')
  async getProtocol(@Param('id') id: string): Promise<ProtocolView> {
    return this.protocolsService.getProtocol(id);
  }
}
