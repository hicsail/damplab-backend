import { Schema } from 'mongoose';

export const AnnotationSchema = new Schema({
  start: { type: Number, required: true },
  end: { type: Number, required: true },
  type: { type: String, required: true },
  description: { type: String }
});

export const SequenceSchema = new Schema(
  {
    name: { type: String, required: true },
    type: { type: String, required: true, enum: ['dna', 'rna', 'aa', 'unknown'], default: 'unknown' },
    seq: { type: String, required: true },
    annotations: { type: [AnnotationSchema], default: [] },
    userId: { type: String, required: true },
    mpiId: { type: String, required: true }
  },
  {
    timestamps: true,
    toJSON: {
      transform: function (doc: any, ret: any): any {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      }
    }
  }
);
