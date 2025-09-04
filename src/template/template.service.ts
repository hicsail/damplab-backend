import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Template, TemplateDocument } from './template.model';
import { CreateTemplateInput } from './dto/create-template.input';
import { UpdateTemplateInput } from './dto/update-template.input';

@Injectable()
export class TemplateService {
  constructor(
    @InjectModel(Template.name)
    private readonly templateModel: Model<TemplateDocument>
  ) {}

  async create(input: CreateTemplateInput): Promise<Template> {
    // Check if a template with this name already exists
    const existingTemplate = await this.templateModel.findOne({ name: input.name });
    if (existingTemplate) {
      throw new ConflictException(`Template with name "${input.name}" already exists`);
    }

    const created = new this.templateModel({
      ...input,
      createdAt: new Date()
    });
    return created.save();
  }

  async findAll(): Promise<Template[]> {
    return this.templateModel.find().sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<Template | null> {
    try {
      return await this.templateModel.findById(id).exec();
    } catch (error) {
      return null;
    }
  }

  async findByName(name: string): Promise<Template | null> {
    return this.templateModel.findOne({ name }).exec();
  }

  async update(input: UpdateTemplateInput): Promise<Template> {
    const template = await this.templateModel.findById(input.id);

    if (!template) {
      throw new NotFoundException(`Template with ID "${input.id}" not found`);
    }

    // If updating name, check for conflicts
    if (input.name && input.name !== template.name) {
      const existingTemplate = await this.templateModel.findOne({
        name: input.name,
        _id: { $ne: input.id }
      });
      if (existingTemplate) {
        throw new ConflictException(`Template with name "${input.name}" already exists`);
      }
    }

    // Update fields
    if (input.name !== undefined) {
      template.name = input.name;
    }
    if (input.description !== undefined) {
      template.description = input.description;
    }
    if (input.columnMapping !== undefined) {
      template.columnMapping = input.columnMapping as any;
    }

    return template.save();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.templateModel.deleteOne({ _id: id });
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Template with ID "${id}" not found`);
    }
    return true;
  }

  async deleteByName(name: string): Promise<boolean> {
    const result = await this.templateModel.deleteOne({ name });
    if (result.deletedCount === 0) {
      throw new NotFoundException(`Template with name "${name}" not found`);
    }
    return true;
  }
}
