import { Field, ObjectType } from '@nestjs/graphql';
import { ApiKey } from './api-key.model';

/**
 * Returned only from createApiKey. Carries the one-time raw secret alongside the
 * stored record — the raw key is never retrievable again after this response.
 */
@ObjectType({ description: 'Result of creating an API key — includes the raw secret shown exactly once.' })
export class CreateApiKeyResult {
  @Field(() => ApiKey)
  apiKey: ApiKey;

  @Field({ description: 'The raw API key secret. Copy it now — it cannot be shown again.' })
  key: string;
}
