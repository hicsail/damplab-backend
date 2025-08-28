import { Injectable, PipeTransform } from '@nestjs/common';
import { ID, Field, InputType, OmitType, Float } from '@nestjs/graphql';
import { BundleNode } from '../models/node.model';
import { DampLabServicePipe } from '../../services/damplab-services.pipe';


@InputType()
export class PositionInput {
  @Field(() => Float)
  x: number;

  @Field(() => Float)
  y: number;
}

@InputType()
export class AddBundleNodeInput extends OmitType(BundleNode, ['_id', 'service', 'position'] as const, InputType) {
  @Field(() => ID, { description: 'The ID of the service this node is a part of' })
  serviceId: string;

  @Field(() => PositionInput, { nullable: true })
  position?: PositionInput; 
}

export type AddNodeInputFull = Omit<BundleNode, '_id'>;

@Injectable()
export class AddNodeInputPipe implements PipeTransform<AddBundleNodeInput, Promise<AddNodeInputFull>> {
  constructor(private readonly dampLabServicePipe: DampLabServicePipe) {}

  async transform(value: AddBundleNodeInput): Promise<AddNodeInputFull> {
    const service = await this.dampLabServicePipe.transform(value.serviceId);
    return { ...value, service };
  }
}
