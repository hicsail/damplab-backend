export interface User {
  // Properties named according to keycloak access token fields
  preferred_username: string;
  sub: string;
  email: string;
  realm_access: {
    roles: string[];
  };
}
