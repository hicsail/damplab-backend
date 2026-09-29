import { Field, ObjectType } from '@nestjs/graphql';

/**
 * One parameter value as it was named and displayed when its node was last
 * written. The catalogue is read live everywhere else, so this is what keeps a
 * renamed or removed parameter readable on the job page and in the export.
 */
@ObjectType({ description: 'A parameter value as named and displayed when the node was last saved, so it stays readable after the catalogue changes.' })
export class ParameterSnapshotEntry {
  @Field()
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  type?: string;

  @Field()
  displayValue: string;
}
