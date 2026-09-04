import { NestFactory } from '@nestjs/core';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory, Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLInputObjectType, GraphQLSchema } from 'graphql';
import { ServiceChange } from './update.dto';
import { InventoryItemChange } from '../../inventory/dtos/update.dto';
import { CategoryChange } from '../../categories/dtos/update.dto';
import { BundleChange } from '../../bundles/dtos/update.dto';

/**
 * A partial-update input must not carry the model's GraphQL default values.
 *
 * `PartialType` copies `defaultValue` from every inherited `@Field` unless told
 * otherwise (`omitDefaultValues`). GraphQL then substitutes those defaults during
 * argument coercion for any field the client *omitted*, before the resolver runs
 * — and `DampLabServices.update` hands `changes` straight to `updateOne`, whose
 * implicit `$set` writes them.
 *
 * The symptom that brought this in: saving only `parameters` from the Catalog
 * Editor's "Configure Parameters" screen rewrote the service's saved `pricingMode`
 * back to SERVICE ("Operation price") and wiped `deliverables`. Nothing downstream
 * can tell "omitted" from "sent as the default" once coercion has run, so the
 * input type is the only layer where this is fixable.
 *
 * Asserted against the built schema rather than the decorator metadata: the
 * default is only harmful once it reaches the schema, and that is the thing
 * coercion reads.
 */

/* Every argument below exists only to pull its input type into the schema. */
/* eslint-disable @typescript-eslint/no-unused-vars */
@Resolver()
class ProbeResolver {
  /** A schema needs a query root before it will validate; nothing reads this. */
  @Query(() => Boolean)
  probe(): boolean {
    return true;
  }

  @Mutation(() => Boolean)
  updateServiceProbe(@Args('changes', { type: () => ServiceChange }) _changes: ServiceChange): boolean {
    return true;
  }

  @Mutation(() => Boolean)
  updateInventoryProbe(@Args('changes', { type: () => InventoryItemChange }) _changes: InventoryItemChange): boolean {
    return true;
  }

  @Mutation(() => Boolean)
  updateCategoryProbe(@Args('changes', { type: () => CategoryChange }) _changes: CategoryChange): boolean {
    return true;
  }

  @Mutation(() => Boolean)
  updateBundleProbe(@Args('changes', { type: () => BundleChange }) _changes: BundleChange): boolean {
    return true;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

describe('partial-update input types carry no default values', () => {
  let schema: GraphQLSchema;

  beforeAll(async () => {
    const app = await NestFactory.create(GraphQLSchemaBuilderModule, { logger: false });
    await app.init();
    schema = await app.get(GraphQLSchemaFactory).create([ProbeResolver]);
    await app.close();
  }, 30000);

  const inputFields = (typeName: string): ReturnType<GraphQLInputObjectType['getFields']> => {
    const type = schema.getType(typeName);
    expect(type).toBeInstanceOf(GraphQLInputObjectType);
    return (type as GraphQLInputObjectType).getFields();
  };

  it.each(['ServiceChange', 'InventoryItemChange', 'CategoryChange', 'BundleChange'])('%s', (typeName) => {
    const withDefaults = Object.values(inputFields(typeName))
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => `${field.name} = ${JSON.stringify(field.defaultValue)}`);

    expect(withDefaults).toEqual([]);
  });

  it('reaches the fields it is meant to be checking', () => {
    // Guards the assertion above from passing vacuously if the input type ever
    // stops being built, or the fields are renamed.
    expect(Object.keys(inputFields('ServiceChange'))).toEqual(expect.arrayContaining(['pricingMode', 'allowMultipleRuns', 'deliverables', 'parameters']));
  });
});
