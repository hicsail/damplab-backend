import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { Template } from './template.model';
import { TemplateService } from './template.service';
import { CreateTemplateInput } from './dto/create-template.input';
import { UpdateTemplateInput } from './dto/update-template.input';
import { NotFoundException } from '@nestjs/common';

@Resolver(() => Template)
export class TemplateResolver {
  constructor(private readonly templateService: TemplateService) {}

  @Query(() => [Template], { description: 'Get all templates' })
  async templates(): Promise<Template[]> {
    return this.templateService.findAll();
  }

  @Query(() => Template, { nullable: true, description: 'Get a template by ID' })
  async template(@Args('id', { type: () => ID }) id: string): Promise<Template | null> {
    return this.templateService.findById(id);
  }

  @Query(() => Template, { nullable: true, description: 'Get a template by name' })
  async templateByName(@Args('name', { type: () => String }) name: string): Promise<Template | null> {
    return this.templateService.findByName(name);
  }

  @Mutation(() => Template, { description: 'Create a new template' })
  async createTemplate(@Args('input') input: CreateTemplateInput): Promise<Template> {
    return this.templateService.create(input);
  }

  @Mutation(() => Template, { description: 'Update an existing template' })
  async updateTemplate(@Args('input') input: UpdateTemplateInput): Promise<Template> {
    return this.templateService.update(input);
  }

  @Mutation(() => Boolean, { description: 'Delete a template by ID' })
  async deleteTemplate(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.templateService.delete(id);
  }

  @Mutation(() => Boolean, { description: 'Delete a template by name' })
  async deleteTemplateByName(@Args('name', { type: () => String }) name: string): Promise<boolean> {
    return this.templateService.deleteByName(name);
  }
}
