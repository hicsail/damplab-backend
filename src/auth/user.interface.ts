export interface User {
  // Properties named according to keycloak access token fields
  preferred_username: string;
  sub: string;
  email: string;
  realm_access: {
    roles: string[];
  };
  groups?: string[];
  /**
   * Set by AuthRolesGuard when the caller authenticated with an x-api-key rather
   * than a Keycloak token. Such callers have no roles and no owning identity, so
   * per-record ownership checks must treat them explicitly. Reads only — the
   * guard rejects mutations from API keys before they reach a resolver.
   */
  apiKey?: boolean;
  readOnly?: boolean;
}
