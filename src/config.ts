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
  }
});
