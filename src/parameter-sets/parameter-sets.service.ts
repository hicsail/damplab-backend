import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { ParameterSet, ParameterSetDocument } from './parameter-set.model';
import { CreateParameterSet, ParameterSetChange } from './dtos/parameter-set.input';
import { normalizeSetName, normalizeSetParameters } from './parameter-set.rules';
import { DampLabServices } from '../services/damplab-services.services';
import { DampLabService } from '../services/models/damplab-service.model';
import { findParameterSetClashes, ParameterSetLike, setsByIdMap } from '../services/effective-parameters';

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class ParameterSetsService {
  constructor(@InjectModel(ParameterSet.name) private readonly model: Model<ParameterSetDocument>, private readonly dampLabServices: DampLabServices) {}

  findAll(): Promise<ParameterSet[]> {
    return this.model.find().sort({ name: 1 }).exec();
  }

  async findById(id: string): Promise<ParameterSet | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return this.model.findById(id).exec();
  }

  usedBy(id: string): Promise<DampLabService[]> {
    return this.dampLabServices.findUsingParameterSet(String(id));
  }

  async create(input: CreateParameterSet): Promise<ParameterSet> {
    const name = normalizeSetName(input.name);
    await this.assertNameFree(name);
    const parameters = normalizeSetParameters(input.parameters);
    return this.model.create({ name, description: input.description?.trim() || undefined, parameters });
  }

  async update(id: string, changes: ParameterSetChange): Promise<ParameterSet> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException(`Parameter set ${id} does not exist`);
    const patch: Record<string, unknown> = {};
    if (changes.name !== undefined && changes.name !== null) {
      patch.name = normalizeSetName(changes.name);
      await this.assertNameFree(patch.name as string, id);
    }
    if (changes.description !== undefined) patch.description = changes.description?.trim() || null;
    if (changes.parameters !== undefined && changes.parameters !== null) {
      patch.parameters = normalizeSetParameters(changes.parameters);
      await this.assertNoClashOnOperations(existing, patch.parameters as any[], (patch.name as string) ?? existing.name);
    }
    await this.model.updateOne({ _id: id }, { $set: patch }).exec();
    return (await this.model.findById(id).exec())!;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException(`Parameter set ${id} does not exist`);
    const users = await this.dampLabServices.findUsingParameterSet(String(id));
    if (users.length > 0) {
      throw new BadRequestException(`"${existing.name}" is used by ${users.map((u) => `"${u.name}"`).join(', ')}. Remove it from those operations first.`);
    }
    await this.model.deleteOne({ _id: id }).exec();
    return true;
  }

  /** Mongo's unique index is case-sensitive; this is the case-insensitive rule. */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.model.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } }).exec();
    if (clash && String(clash._id) !== String(exceptId)) throw new BadRequestException(`A parameter set named "${clash.name}" already exists.`);
  }

  /** Pin 7: a set edit may not give any operation using it the same parameter id twice. */
  private async assertNoClashOnOperations(set: ParameterSet, parameters: any[], name: string): Promise<void> {
    const users = await this.dampLabServices.findUsingParameterSet(String(set._id));
    if (users.length === 0) return;
    const otherIds = [...new Set(users.flatMap((u) => (u.parameterSetIds ?? []).map(String)))].filter((i) => i !== String(set._id));
    const others = otherIds.length ? await this.model.find({ _id: { $in: otherIds } }).exec() : [];
    const byId = setsByIdMap(others as unknown as ParameterSetLike[]);
    byId.set(String(set._id), { _id: set._id, name, parameters });
    const clashing = users
      .filter((u) => findParameterSetClashes((u.parameterSetIds ?? []).map((i) => byId.get(String(i))).filter((s): s is ParameterSetLike => Boolean(s))).length > 0)
      .map((u) => `"${u.name}"`);
    if (clashing.length > 0) {
      throw new BadRequestException(
        `Saving "${name}" would give ${clashing.join(', ')} the same parameter id from two sets. Rename the parameter or remove one of the sets from those operations first.`
      );
    }
  }
}
