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
    disable: process.env.DISABLE_AUTH == 'true' || false,
    /**
     * Roles to act as while DISABLE_AUTH is on, comma-separated
     * (e.g. DEV_AS_ROLES=technician). Lets each role's gates be exercised locally
     * instead of every request being omnipotent staff. Unset = damplab-staff,
     * which is what the bypass has always granted.
     */
    devAsRoles: (process.env.DEV_AS_ROLES ?? '')
      .split(',')
      .map((r: string) => r.trim())
      .filter(Boolean)
  },
  /**
   * Dev-only database reset mutations (clearDatabase / loadData). Off unless
   * explicitly enabled; read directly from process.env in app.module.ts because
   * the decision is made at module-registration time, before ConfigService exists.
   */
  reset: {
    enabled: process.env.ENABLE_RESET_MODULE === 'true'
  },
  /** Keycloak Admin API: used to fetch lab monitor staff from a realm group (e.g. damplab-staff). All optional. */
  keycloak: {
    serverUrl: process.env.KEYCLOAK_SERVER_URL,
    realm: process.env.KEYCLOAK_REALM || 'damplab',
    clientId: process.env.KEYCLOAK_CLIENT_ID,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
    /**
     * Realm groups whose members are shown in the lab monitor assignee dropdown and
     * in Customer Management's STAFF filter. Comma-separated.
     *
     * This has to be a list, not a name: the moment someone moves from the
     * `damplab-staff` group to `technician` they would vanish from the assignee
     * dropdown, and technicians are precisely who should be assignable. Widening it
     * is a code deploy and must land BEFORE anyone is moved in Keycloak.
     *
     * Falls back to the old singular KEYCLOAK_LAB_STAFF_GROUP_NAME so a deployed
     * environment carrying only that variable does not silently lose its group.
     */
    labStaffGroupNames: (process.env.KEYCLOAK_LAB_STAFF_GROUP_NAMES || process.env.KEYCLOAK_LAB_STAFF_GROUP_NAME || 'damplab-staff,technician')
      .split(',')
      .map((n: string) => n.trim())
      .filter(Boolean)
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
  /**
   * ClickUp: the bug backlog lives in a ClickUp list, surfaced read/comment-only
   * inside the app at /backlog. Cards are CREATED by the n8n triage workflow, not
   * by the backend — the backend only reads them and appends comments.
   */
  clickup: {
    /** Personal API token (pk_...). Read + comment scope is all that's used. */
    apiToken: process.env.CLICKUP_API_TOKEN,
    /** The list backing the in-app backlog (DAMPLab Canvas — Bug Triage). */
    bugListId: process.env.CLICKUP_BUG_LIST_ID,
    apiBaseUrl: process.env.CLICKUP_API_BASE_URL || 'https://api.clickup.com/api/v2',
    /**
     * Seconds to cache the board listing. ClickUp allows ~100 requests/minute per
     * token, and every /backlog page view would otherwise hit it, so a short
     * cache keeps concurrent viewers from exhausting the budget.
     */
    listCacheSeconds: Number(process.env.CLICKUP_LIST_CACHE_SECONDS ?? 45)
  },
  /** Agents: backend proxies chat to n8n webhooks. One entry per agent. */
  agent: {
    /** Canvas workflow-builder agent (catalog injected). */
    webhookUrl: process.env.N8N_AGENT_WEBHOOK_URL,
    /** Lab-status agent (queries Mongo directly via n8n; no catalog injection). */
    labStatusWebhookUrl: process.env.N8N_LAB_STATUS_WEBHOOK_URL,
    /** Bug triage: fired after a bug report is saved, so n8n can triage + file a ClickUp card. */
    bugTriageWebhookUrl: process.env.N8N_BUG_TRIAGE_WEBHOOK_URL,
    /** Shared secret sent as the x-agent-secret header to the n8n webhooks. */
    webhookSecret: process.env.N8N_AGENT_WEBHOOK_SECRET
  }
});
