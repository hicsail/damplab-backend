import { NestFactory } from '@nestjs/core';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { DampLabServicesResolver } from '../services/damplab-services.resolver';
import { ParameterSetsResolver } from '../parameter-sets/parameter-sets.resolver';
import { UploadLogResolver } from '../inventory/upload-log.resolver';
import { CatalogExportResolver } from './catalog-export.resolver';

describe('Catalog Editor GraphQL schema (Global Constraints, verbatim)', () => {
  let schema: GraphQLSchema;

  beforeAll(async () => {
    const app = await NestFactory.create(GraphQLSchemaBuilderModule, { logger: false });
    await app.init();
    schema = await app.get(GraphQLSchemaFactory).create([DampLabServicesResolver, ParameterSetsResolver, UploadLogResolver, CatalogExportResolver]);
    await app.close();
  }, 30000);

  const fieldType = (typeName: string, field: string): string => String((schema.getType(typeName) as GraphQLObjectType).getFields()[field]?.type);
  const argsOf = (root: 'Query' | 'Mutation', field: string): string => ((schema.getType(root) as GraphQLObjectType).getFields()[field]?.args ?? []).map((a) => `${a.name}: ${a.type}`).join(', ');

  it.each([
    ['DampLabService', 'parameters', 'JSON!'],
    ['DampLabService', 'ownParameters', 'JSON'],
    ['DampLabService', 'parameterSetIds', '[ID!]!'],
    ['DampLabService', 'parameterSets', '[ParameterSet!]!'],
    ['DampLabService', 'hiddenFromClients', 'Boolean!'],
    ['CatalogServiceView', 'hiddenFromClients', 'Boolean!'],
    ['ParameterSet', 'id', 'ID!'],
    ['ParameterSet', 'name', 'String!'],
    ['ParameterSet', 'description', 'String'],
    ['ParameterSet', 'parameters', 'JSON!'],
    ['ParameterSet', 'usedBy', '[DampLabService!]!'],
    ['ParameterSet', 'createdAt', 'DateTime!'],
    ['ParameterSet', 'updatedAt', 'DateTime!'],
    ['UploadLog', 'entityType', 'UploadEntityType!'],
    ['Query', 'parameterSets', '[ParameterSet!]!'],
    ['Query', 'parameterSet', 'ParameterSet'],
    ['Query', 'catalogExport', 'JSON!'],
    ['Query', 'deletedServiceIds', '[ID!]!'],
    ['Mutation', 'createParameterSet', 'ParameterSet!'],
    ['Mutation', 'updateParameterSet', 'ParameterSet!'],
    ['Mutation', 'deleteParameterSet', 'Boolean!']
  ])('%s.%s is %s', (typeName, field, expected) => {
    expect(fieldType(typeName, field)).toBe(expected);
  });

  it('takes the documented arguments', () => {
    expect(argsOf('Query', 'parameterSet')).toBe('id: ID!');
    expect(argsOf('Mutation', 'createParameterSet')).toBe('parameterSet: CreateParameterSet!');
    expect(argsOf('Mutation', 'updateParameterSet')).toBe('id: ID!, changes: ParameterSetChange!');
    expect(argsOf('Mutation', 'deleteParameterSet')).toBe('id: ID!');
  });

  it('has the UploadEntityType enum and the new input fields', () => {
    expect(schema.getType('UploadEntityType')?.toString()).toBe('UploadEntityType');
    expect(Object.keys((schema.getType('CreateService') as any).getFields())).toEqual(expect.arrayContaining(['parameterSetIds', 'hiddenFromClients']));
    expect(Object.keys((schema.getType('CreateService') as any).getFields())).not.toContain('ownParameters');
    expect(Object.keys((schema.getType('CreateUploadLogInput') as any).getFields())).toContain('entityType');
  });
});
