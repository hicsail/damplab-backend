import { Schema } from 'mongoose';
import { SequenceSchema } from './sequence.schema';
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
    userId: { type: String, required: true }
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc, ret): any {
        ret.id = ret._id;
        ret.created_at = ret.createdAt;
        ret.updated_at = ret.updatedAt;
        delete ret._id;
        delete ret.__v;
        delete ret.createdAt;
        delete ret.updatedAt;
        return ret;
      }
    }
  }
);
