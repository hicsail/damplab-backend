import { Schema } from 'mongoose';
import { Region } from '../types';

export const HazardHitsSchema = new Schema({
  name: { type: String, required: true },
  hit_regions: [
    {
      seq: { type: String, required: true },
      seq_range_start: { type: Number, required: true },
      seq_range_end: { type: Number, required: true }
    }
  ],
  is_wild_type: { type: Boolean, required: true, default: false },
  references: { type: [String], default: [] }
});

export const ScreeningResultSchema = new Schema(
  {
    sequence: { type: Schema.Types.ObjectId, ref: 'Sequence', required: true },
    region: { type: String, required: true, enum: Object.values(Region) },
    threats: { type: [HazardHitsSchema], default: [] },
    status: { type: String, required: true, enum: ['granted', 'denied'] },
    userId: { type: String, required: true },
    /** Echoes MPI batch / provider_reference (same for all rows from one screen call) */
    providerReference: { type: String, required: false }
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (_doc, ret): Record<string, unknown> {
        const r = ret as Record<string, unknown>;
        r.id = r._id;
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
