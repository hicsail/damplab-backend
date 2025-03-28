import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';

export interface ITokenStore {
  userId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiration: Date;
  userInfo?: any;
}

@Schema({ timestamps: true })
export class TokenStore implements ITokenStore {
  @Prop({ required: true, unique: true })
  userId: string;

  @Prop({ required: true })
  accessToken: string;

  @Prop({ required: true })
  refreshToken: string;

  @Prop({ required: true })
  accessTokenExpiration: Date;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  userInfo?: any;
}

export type TokenStoreDocument = TokenStore & Document;
export const TokenStoreSchema = SchemaFactory.createForClass(TokenStore);
