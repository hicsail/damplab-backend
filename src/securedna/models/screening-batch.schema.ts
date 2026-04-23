import { Schema } from 'mongoose';
import { Region } from '../region';

const ScreeningDiagnosticSchema = new Schema(
  {
    diagnostic: { type: String, required: true },
    additional_info: { type: String, required: true },
    line_number_range: { type: [Number], required: false }
  },
  { _id: false }
);

const ScreeningBatchSequenceSliceSchema = new Schema(
  {
    sequence: { type: Schema.Types.ObjectId, ref: 'Sequence', required: true },
    recordId: { type: String, required: true },
    name: { type: String, required: true },
    order: { type: Number, required: true },
    originalSeq: { type: String, required: true },
    threats: { type: [Schema.Types.Mixed], default: [] },
    warning: { type: String, required: false }
  },
  { _id: false }
);

export const ScreeningBatchSchema = new Schema(
  {
    batchRunId: { type: String, required: true },
    screeningCompletedAt: { type: Date, required: true },
    synthesisPermission: { type: String, required: true, enum: ['granted', 'denied'] },
    region: { type: String, required: true, enum: Object.values(Region) },
    providerReference: { type: String, default: null },
    hitsByRecord: { type: [Schema.Types.Mixed], default: [] },
    warnings: { type: [ScreeningDiagnosticSchema], default: [] },
    errors: { type: [ScreeningDiagnosticSchema], default: [] },
    verifiable: { type: Schema.Types.Mixed, required: false },
    sequences: { type: [ScreeningBatchSequenceSliceSchema], required: true },
    userId: { type: String, required: true }
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (_doc, ret): Record<string, unknown> {
        const r = ret as Record<string, unknown> & {
          _id?: unknown;
          __v?: unknown;
          createdAt?: Date;
          updatedAt?: Date;
        };
        r.id = String(r._id);
        r.created_at = r.createdAt;
        r.updated_at = r.updatedAt;
        delete r._id;
        delete r.__v;
        delete r.createdAt;
        delete r.updatedAt;
        return r;
      }
    }
  }
);
