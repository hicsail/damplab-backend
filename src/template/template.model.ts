import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { Field, ID, ObjectType, Int } from '@nestjs/graphql';

@ObjectType({ description: 'Represents a column mapping configuration for Excel templates' })
export class ColumnMapping {
  @Field({ description: 'The field identifier' })
  field: string;

  @Field({ description: 'The display name for the column header' })
  headerName: string;

  @Field({ description: 'The data type of the column' })
  type: string;

  @Field(() => Int, { description: 'The width of the column in pixels' })
  width: number;

  @Field(() => Int, { description: 'The order position of the column' })
  order: number;
}

@Schema()
@ObjectType({ description: 'Represents an Excel template configuration' })
export class Template {
  /** Database generated ID */
  @Field(() => ID, { name: 'id', description: 'unique database generated ID' })
  _id: string;

  @Prop({ required: true })
  @Field({ description: 'The name of the template' })
  name: string;

  @Prop()
  @Field({ nullable: true, description: 'Optional description of the template' })
  description?: string;

  @Prop({ default: Date.now })
  @Field({ description: 'When the template was created' })
  createdAt: Date;

  @Prop({
    type: [
      {
        field: { type: String, required: true },
        headerName: { type: String, required: true },
        type: { type: String, required: true },
        width: { type: Number, required: true },
        order: { type: Number, required: true }
      }
    ],
    required: true
  })
  @Field(() => [ColumnMapping], { description: 'Column mapping configuration' })
  columnMapping: ColumnMapping[];
}

export type TemplateDocument = Template & mongoose.Document;
export const TemplateSchema = SchemaFactory.createForClass(Template);
