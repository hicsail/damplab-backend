import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { SowTextPreset, SowPresetSection } from './sow-text-preset.model';
import { SowTextPresetService, PresetAuthor } from './sow-text-preset.service';
import { CreateSowTextPresetInput, ReorderSowTextPresetsInput, UpdateSowTextPresetInput } from './dto/sow-text-preset.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';

/**
 * The text-block library. Reads are open to any authenticated caller because the
 * SOW editor needs them; every write is staff-only, matching the rest of the
 * catalog (see CategoryResolver).
 */
@Resolver(() => SowTextPreset)
@UseGuards(AuthRolesGuard)
export class SowTextPresetResolver {
  constructor(private readonly presetService: SowTextPresetService) {}

  private static author(user?: User): PresetAuthor {
    // With DISABLE_AUTH set, AuthRolesGuard admits the request without attaching
    // a user, so local dev has nobody to name. Say that, rather than crashing on
    // the read of user.sub — the attribution is a label on a block, not a check.
    if (!user) return { sub: 'unknown', name: 'Unknown user' };
    return { sub: user.sub, name: user.preferred_username || user.email || user.sub };
  }

  @Query(() => [SowPresetSection], { description: 'Every SOW prose section with a summary of its text-block library.' })
  async sowPresetSections(): Promise<SowPresetSection[]> {
    return this.presetService.listSections();
  }

  @Query(() => [SowTextPreset], { description: 'Text blocks, default first. Omit sectionKey for the whole library.' })
  async sowTextPresets(@Args('sectionKey', { type: () => String, nullable: true }) sectionKey?: string): Promise<SowTextPreset[]> {
    return sectionKey ? this.presetService.listForSection(sectionKey) : this.presetService.listAll();
  }

  @Mutation(() => SowTextPreset)
  @RequirePermission(Permission.CatalogEditorWrite)
  async createSowTextPreset(@Args('preset') preset: CreateSowTextPresetInput, @CurrentUser() user: User): Promise<SowTextPreset> {
    return this.presetService.create(preset.sectionKey, preset.name, preset.text, SowTextPresetResolver.author(user));
  }

  @Mutation(() => SowTextPreset)
  @RequirePermission(Permission.CatalogEditorWrite)
  async updateSowTextPreset(@Args('id', { type: () => ID }) id: string, @Args('changes') changes: UpdateSowTextPresetInput, @CurrentUser() user: User): Promise<SowTextPreset> {
    return this.presetService.update(id, changes, SowTextPresetResolver.author(user));
  }

  @Mutation(() => Boolean)
  @RequirePermission(Permission.CatalogEditorWrite)
  async deleteSowTextPreset(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.presetService.delete(id);
  }

  @Mutation(() => [SowTextPreset], { description: 'Renumbers a section. The block left at the top becomes its default.' })
  @RequirePermission(Permission.CatalogEditorWrite)
  async reorderSowTextPresets(@Args('order') order: ReorderSowTextPresetsInput): Promise<SowTextPreset[]> {
    return this.presetService.reorder(order.sectionKey, order.orderedIds);
  }
}
