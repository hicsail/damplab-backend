import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Template } from './template.model';
import { TemplateService } from './template.service';
import { CreateTemplateInput } from './dto/create-template.input';
import { UpdateTemplateInput } from './dto/update-template.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';

/**
 * This resolver carried **no `@UseGuards` at all** — three unauthenticated queries
 * and four unauthenticated write mutations, reachable by anyone who could reach
 * the endpoint. Adding the guard is a bug fix, not a permission decision.
 *
 * The permission is `datatranslation:use`, **not** the `catalog-editor:*` pair the
 * 2b checklist proposed. `Template` is a Data Translation Excel column-mapping
 * config, not a catalog type — the name misleads. Its only consumer is
 * `/data_translation`, which the matrix places at `datatranslation:use`
 * (Administrator-only), so this matches the page rather than widening it. Read and
 * write are not split: the matrix gives Data Translation a single cell.
 */
@Resolver(() => Template)
@UseGuards(AuthRolesGuard)
export class TemplateResolver {
  constructor(private readonly templateService: TemplateService) {}

  @Query(() => [Template], { description: 'Get all templates' })
  @RequirePermission(Permission.DataTranslationUse)
  async templates(): Promise<Template[]> {
    return this.templateService.findAll();
  }

  @Query(() => Template, { nullable: true, description: 'Get a template by ID' })
  @RequirePermission(Permission.DataTranslationUse)
  async template(@Args('id', { type: () => ID }) id: string): Promise<Template | null> {
    return this.templateService.findById(id);
  }

  @Query(() => Template, { nullable: true, description: 'Get a template by name' })
  @RequirePermission(Permission.DataTranslationUse)
  async templateByName(@Args('name', { type: () => String }) name: string): Promise<Template | null> {
    return this.templateService.findByName(name);
  }

  @Mutation(() => Template, { description: 'Create a new template' })
  @RequirePermission(Permission.DataTranslationUse)
  async createTemplate(@Args('input') input: CreateTemplateInput): Promise<Template> {
    return this.templateService.create(input);
  }

  @Mutation(() => Template, { description: 'Update an existing template' })
  @RequirePermission(Permission.DataTranslationUse)
  async updateTemplate(@Args('input') input: UpdateTemplateInput): Promise<Template> {
    return this.templateService.update(input);
  }

  @Mutation(() => Boolean, { description: 'Delete a template by ID' })
  @RequirePermission(Permission.DataTranslationUse)
  async deleteTemplate(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.templateService.delete(id);
  }

  @Mutation(() => Boolean, { description: 'Delete a template by name' })
  @RequirePermission(Permission.DataTranslationUse)
  async deleteTemplateByName(@Args('name', { type: () => String }) name: string): Promise<boolean> {
    return this.templateService.deleteByName(name);
  }
}
