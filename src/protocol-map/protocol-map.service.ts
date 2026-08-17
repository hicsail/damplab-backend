import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProtocolStepMapping, ProtocolStepMappingDocument } from './protocol-step-mapping.model';
import { UpsertProtocolStepMappingInput } from './protocol-map.dto';

@Injectable()
export class ProtocolMapService {
  constructor(@InjectModel(ProtocolStepMapping.name) private readonly model: Model<ProtocolStepMappingDocument>) {}

  /** Upsert the mapping for one (protocolId, stepId). The author UI sends the full desired state. */
  async upsert(input: UpsertProtocolStepMappingInput, updatedBy?: string): Promise<ProtocolStepMapping> {
    const set: Record<string, unknown> = { protocolId: input.protocolId, stepId: input.stepId, updatedBy };
    // NOTE: `serviceId` is intentionally absent — per-step service mapping was
    // removed (the operation↔protocol link lives on DampLabService.protocolIds).
    // Legacy values already in Mongo are simply left untouched, not deleted.
    for (const k of ['stepNumber', 'stepTitle', 'equipmentIds', 'requiresNoEquipment', 'paramTags', 'reviewed'] as const) {
      if (input[k] !== undefined) set[k] = input[k] as unknown;
    }
    return (await this.model.findOneAndUpdate({ protocolId: input.protocolId, stepId: input.stepId }, { $set: set }, { upsert: true, new: true, setDefaultsOnInsert: true }).exec())!;
  }

  async findByProtocol(protocolId: string): Promise<ProtocolStepMapping[]> {
    return this.model.find({ protocolId }).exec();
  }

  async remove(protocolId: string, stepId: string): Promise<boolean> {
    const res = await this.model.deleteOne({ protocolId, stepId }).exec();
    return res.deletedCount > 0;
  }
}
