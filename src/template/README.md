# Template Module

This module provides backend support for Excel template management functionality. Users can create, update, and manage templates that define how Excel columns should be formatted and ordered.

## Features

- **Create Templates**: Create new templates with column mapping configurations
- **List Templates**: Retrieve all available templates
- **Find by ID/Name**: Find specific templates by ID or name
- **Update Templates**: Modify existing template configurations
- **Delete Templates**: Remove templates by ID or name
- **Conflict Prevention**: Prevents duplicate template names

## GraphQL Schema

### Types

```graphql
type Template {
  id: ID!
  name: String!
  description: String
  createdAt: String!
  columnMapping: [ColumnMapping!]!
}

type ColumnMapping {
  field: String!
  headerName: String!
  type: String!
  width: Int!
  order: Int!
}
```

### Queries

```graphql
# Get all templates
templates: [Template!]!

# Get template by ID
template(id: ID!): Template

# Get template by name
templateByName(name: String!): Template
```

### Mutations

```graphql
# Create a new template
createTemplate(input: CreateTemplateInput!): Template!

# Update an existing template
updateTemplate(input: UpdateTemplateInput!): Template!

# Delete a template by ID
deleteTemplate(id: ID!): Boolean!

# Delete a template by name
deleteTemplateByName(name: String!): Boolean!
```

## Usage Examples

### Create a Template

```graphql
mutation {
  createTemplate(input: {
    name: "Lab Results Template"
    description: "Standard format for lab result data"
    columnMapping: [
      {
        field: "sampleId"
        headerName: "Sample ID"
        type: "string"
        width: 120
        order: 1
      }
      {
        field: "testResult"
        headerName: "Test Result"
        type: "number"
        width: 100
        order: 2
      }
    ]
  }) {
    id
    name
    createdAt
  }
}
```

### Get All Templates

```graphql
query {
  templates {
    id
    name
    description
    createdAt
    columnMapping {
      field
      headerName
      type
      width
      order
    }
  }
}
```

### Update a Template

```graphql
mutation {
  updateTemplate(input: {
    id: "template-id-here"
    name: "Updated Lab Results Template"
    columnMapping: [
      {
        field: "sampleId"
        headerName: "Sample Identifier"
        type: "string"
        width: 150
        order: 1
      }
    ]
  }) {
    id
    name
    columnMapping {
      field
      headerName
      width
    }
  }
}
```

## Database Schema

The templates are stored in MongoDB with the following structure:

```typescript
{
  _id: ObjectId,
  name: string (required, unique),
  description?: string,
  createdAt: Date,
  columnMapping: [
    {
      field: string,
      headerName: string,
      type: string,
      width: number,
      order: number
    }
  ]
}
```

## Error Handling

The service handles the following error cases:

- **ConflictException**: When trying to create a template with a name that already exists
- **NotFoundException**: When trying to update/delete a template that doesn't exist
- **ValidationError**: When required fields are missing or invalid

## Integration

The Template module is automatically registered in the main `AppModule` and will be available as soon as the server starts. The GraphQL schema will include all template types and operations.
