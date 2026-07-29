import { Field, ID, InputType, Int, Float } from '@nestjs/graphql';

@InputType()
export class CreateStationInput {
  @Field() name: string;
  @Field({ nullable: true }) type?: string;
  @Field({ nullable: true }) zone?: string;
  @Field(() => Int, { nullable: true }) capacity?: number;
  @Field(() => Float, { nullable: true }) x?: number;
  @Field(() => Float, { nullable: true }) y?: number;
  @Field({ nullable: true }) notes?: string;
}

@InputType()
export class UpdateStationInput {
  @Field(() => ID) id: string;
  @Field({ nullable: true }) name?: string;
  @Field({ nullable: true }) type?: string;
  @Field({ nullable: true }) zone?: string;
  @Field(() => Int, { nullable: true }) capacity?: number;
  @Field(() => Float, { nullable: true }) x?: number;
  @Field(() => Float, { nullable: true }) y?: number;
  @Field({ nullable: true }) notes?: string;
}
