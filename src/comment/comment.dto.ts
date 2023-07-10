import { InputType, Field, ID } from '@nestjs/graphql';
import mongoose from 'mongoose';

@InputType()
export class CreateComment {
  @Field({ description: 'Comment text message ' })
  message: string;

  @Field(() => ID, { description: 'Job which the comment is under' })
  job: mongoose.Types.ObjectId;
}
