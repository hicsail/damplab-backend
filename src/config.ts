export default (): any => ({
  health: {
    /** How full the storage has to be to be considered unhealthy as a percentage */
    storageThreshold: process.env.STORAGE_THRESHOLD || 0.75,
    /** Much much memory in bytes to be considered unhealthy */
    memoryThreshold: process.env.MEMORY_THRESHOLD || 100 * 1024 * 1024
  },
  database: {
    /** The URI to connect to the database */
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/damplab'
  },
  auth: {
    /* The JWKs endpoint at which to fetch keys for verifying JWTs */
    jwksEndpoint: process.env.JWKS_ENDPOINT,
    /* Disable auth for easier gql testing - use only in development */
    disable: process.env.DISABLE_AUTH == 'true' || false
  },
  /** Keycloak Admin API: used to fetch lab monitor staff from a realm group (e.g. damplab-staff). All optional. */
  keycloak: {
    serverUrl: process.env.KEYCLOAK_SERVER_URL,
    realm: process.env.KEYCLOAK_REALM || 'damplab',
    clientId: process.env.KEYCLOAK_CLIENT_ID,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    /** Realm group name whose members are shown in the lab monitor assignee dropdown. Default: damplab-staff */
    labStaffGroupName: process.env.KEYCLOAK_LAB_STAFF_GROUP_NAME || 'damplab-staff'
  },
  attachments: {
    bucket: process.env.JOB_ATTACHMENTS_BUCKET,
    uploadUrlTtlSeconds: process.env.JOB_ATTACHMENTS_UPLOAD_URL_TTL || 900
  },
  /** protocols.io integration: link services to protocols and proxy reads (token stays server-side). */
  protocolsio: {
    /** Personal access token / API key used as a Bearer token against the protocols.io API. */
    apiKey: process.env.PROTOCOLS_IO_API_KEY,
    /** OAuth client id (reserved for future write/import flows; not required for read proxy). */
    clientId: process.env.PROTOCOLS_IO_CLIENT_ID,
    /** OAuth client secret (reserved; never sent to the browser). */
    clientSecret: process.env.PROTOCOLS_IO_CLIENT_SECRET,
    /** API base URL. */
    apiBaseUrl: process.env.PROTOCOLS_IO_API_BASE_URL || 'https://www.protocols.io/api/v4'
  },
  /** Agents: backend proxies chat to n8n webhooks. One entry per agent. */
  agent: {
    /** Canvas workflow-builder agent (catalog injected). */
    webhookUrl: process.env.N8N_AGENT_WEBHOOK_URL,
    /** Lab-status agent (queries Mongo directly via n8n; no catalog injection). */
    labStatusWebhookUrl: process.env.N8N_LAB_STATUS_WEBHOOK_URL,
    /** Shared secret sent as the x-agent-secret header to the n8n webhooks. */
    webhookSecret: process.env.N8N_AGENT_WEBHOOK_SECRET
  }
});
