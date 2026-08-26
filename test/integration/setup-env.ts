/**
 * Runs before the test framework and before any test file imports AppModule.
 *
 * config.ts reads process.env at module-load time, and @nestjs/config's dotenv
 * pass never overwrites a variable that is already set — so pointing MONGO_URI
 * at a scratch database here is what keeps `npm run test:integration` from
 * dropping the developer's real one.
 */
process.env.MONGO_URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27018/damplab_itest';

// AuthModule calls getOrThrow('auth.jwksEndpoint') while it is being constructed,
// so the app cannot boot without a value. Nothing ever dereferences it: the tests
// replace AuthRolesGuard, which is the only code that would reach for a key.
process.env.JWKS_ENDPOINT = 'http://127.0.0.1:1/jwks-never-fetched';

// The bypass in auth.guard.ts returns true WITHOUT setting request.user, which
// would hand every resolver an undefined @CurrentUser(). The guard override in
// harness.ts supplies real identities instead; this makes sure a developer's
// local .env cannot quietly switch that off.
delete process.env.DISABLE_AUTH;
