import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Runs before the test framework and before any test file imports AppModule.
 *
 * config.ts reads process.env at module-load time, and @nestjs/config's dotenv
 * pass never overwrites a variable that is already set — so pointing MONGO_URI
 * at a scratch database here is what keeps `npm run test:integration` from
 * dropping the developer's real one.
 */
/**
 * Reads one key out of the backend's .env.
 *
 * Deliberately NOT a dotenv pass: this file's whole job is to control the
 * environment *before* dotenv runs (see above), and loading the developer's
 * whole .env here would pull in their real MONGO_URI and DISABLE_AUTH. We want
 * exactly one thing from it — which port their Mongo is published on — so we
 * read that key and nothing else.
 */
function fromEnvFile(key: string): string | undefined {
  try {
    const text = readFileSync(join(process.cwd(), '.env'), 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim().replace(/^export\s+/, '');
      if (!line.startsWith(`${key}=`)) continue;
      // Strip surrounding quotes; stop at an inline comment.
      return (
        line
          .slice(key.length + 1)
          .replace(/\s+#.*$/, '')
          .replace(/^["']|["']$/g, '')
          .trim() || undefined
      );
    }
  } catch {
    // No .env (CI) — fall through to the defaults below.
  }
  return undefined;
}

/**
 * The scratch database, never the developer's real one: only the *port* is taken
 * from the environment, and the database name is always `damplab_itest`.
 *
 * Precedence: an explicit MONGO_TEST_URI (what CI sets) wins; otherwise the port
 * comes from MONGO_HOST_PORT — the same knob docker-compose.yml substitutes — read
 * from the shell first and then from .env, because jest performs no dotenv pass of
 * its own. Defaults to 27017, matching docker-compose.yml.
 */
const testPort = process.env.MONGO_HOST_PORT ?? fromEnvFile('MONGO_HOST_PORT') ?? '27017';
process.env.MONGO_URI = process.env.MONGO_TEST_URI ?? fromEnvFile('MONGO_TEST_URI') ?? `mongodb://localhost:${testPort}/damplab_itest`;

// AuthModule calls getOrThrow('auth.jwksEndpoint') while it is being constructed,
// so the app cannot boot without a value. Nothing ever dereferences it: the tests
// replace AuthRolesGuard, which is the only code that would reach for a key.
process.env.JWKS_ENDPOINT = 'http://127.0.0.1:1/jwks-never-fetched';

// The bypass in auth.guard.ts returns true WITHOUT setting request.user, which
// would hand every resolver an undefined @CurrentUser(). The guard override in
// harness.ts supplies real identities instead; this makes sure a developer's
// local .env cannot quietly switch that off.
delete process.env.DISABLE_AUTH;

/**
 * Unconfigure the Keycloak Admin API for the duration of the run.
 *
 * `KeycloakService.isConfigured()` is true whenever a server URL, client id and
 * secret are all present, and a developer's `.env` normally has all three pointing
 * at the shared **staging** realm. So `changeJobCustomerCategory` would try to add
 * the fixture user `customer-sub-1` to a real group there, get a 404, and — quite
 * correctly — refuse to reprice the job. The DOCUMENT_STALE test then fails.
 *
 * Two reasons this is neutralised rather than mocked: the suite passed in CI and
 * failed on every machine with a populated `.env`, which is the exact asymmetry this
 * file exists to remove; and an integration run should not be making live calls
 * against a shared realm at all. Unconfigured, the resolver takes its documented
 * "no Admin API" branch, logs a warning, and updates the job categories — which is
 * what these tests are about.
 *
 * **Set to empty, not `delete`d** — and that difference is the whole trick. dotenv
 * skips a key that is already present in `process.env`, so assigning wins; deleting
 * one merely clears the way for `.env` to put it back a moment later, when
 * ConfigModule runs. `MONGO_URI` above works for the same reason. (`DISABLE_AUTH`
 * gets away with `delete` only because it is usually absent from `.env` — assigning
 * would be safer there too.)
 */
process.env.KEYCLOAK_SERVER_URL = '';
process.env.KEYCLOAK_CLIENT_ID = '';
process.env.KEYCLOAK_CLIENT_SECRET = '';
