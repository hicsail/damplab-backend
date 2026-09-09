import { assertLocalUri, buildFixtures, fixtureUriFrom } from './seed-audit-fixtures';

/**
 * The guard matters more than the fixtures.
 *
 * This script inserts and drops collections. Pointed at a deployment it would do
 * exactly the damage it exists to help people avoid, so "is this URI local" is the
 * one thing worth pinning hard.
 */
describe('assertLocalUri', () => {
  it.each([
    'mongodb://localhost:27017/damplab',
    'mongodb://localhost:27018/damplab',
    'mongodb://127.0.0.1:27017/damplab',
    // The compose-network hostnames, so this still works from inside a container.
    'mongodb://backend-db:27017/damplab',
    'mongodb://mongo:27017/damplab'
  ])('allows %s', (uri) => {
    expect(() => assertLocalUri(uri)).not.toThrow();
  });

  it.each(['mongodb://damplab-backend.sail.codes:27017/damplab', 'mongodb://10.0.1.5:27017/damplab', 'mongodb://user:pw@cluster.example.com:27017/damplab'])('refuses %s', (uri) => {
    expect(() => assertLocalUri(uri)).toThrow(/non-local/i);
  });

  it('refuses a hosted cluster outright, whatever the host resolves to', () => {
    expect(() => assertLocalUri('mongodb+srv://user:pw@cluster0.mongodb.net/damplab')).toThrow(/hosted cluster/i);
  });

  it('refuses a seed list where any single host is remote', () => {
    expect(() => assertLocalUri('mongodb://localhost:27017,prod.example.com:27017/damplab')).toThrow(/non-local/i);
  });

  it('refuses something that is not a connection string at all rather than guessing', () => {
    expect(() => assertLocalUri('damplab')).toThrow(/not a Mongo connection string/i);
  });

  it('allows a local seed list, which is not a valid URL and must not be rejected as one', () => {
    expect(() => assertLocalUri('mongodb://localhost:27017,127.0.0.1:27018/damplab')).not.toThrow();
  });
});

describe('fixtureUriFrom', () => {
  it('swaps the database name so the app database is never the target', () => {
    expect(fixtureUriFrom('mongodb://localhost:27018/damplab')).toBe('mongodb://localhost:27018/damplab_audit_fixtures');
  });

  it('keeps query options, which the connection may need', () => {
    expect(fixtureUriFrom('mongodb://localhost:27017/damplab?replicaSet=rs0')).toBe('mongodb://localhost:27017/damplab_audit_fixtures?replicaSet=rs0');
  });

  it('adds a database name when the URI carries none', () => {
    expect(fixtureUriFrom('mongodb://localhost:27017')).toBe('mongodb://localhost:27017/damplab_audit_fixtures');
  });
});

describe('buildFixtures', () => {
  it('covers every bucket the countersign audit can report, plus the cases it must not flag', () => {
    const { sows, versions } = buildFixtures();
    const versionsFor = (jobId: string): any[] => {
      const sow = sows.find((s) => s.jobId === jobId);
      return versions.filter((v) => v.sowId === String(sow._id));
    };

    expect(versionsFor('job-legacy')).toHaveLength(0);
    expect(versionsFor('job-withdrawn').some((v) => v.status === 'FINAL')).toBe(true);
    expect(sows.find((s) => s.jobId === 'job-countersigned')).toMatchObject({ activeVersionNumber: 1001 });
  });

  it('gives the booking audit one of each: categorised, unchanged, fell-through and null-priced', () => {
    const { bookings, inventoryitems } = buildFixtures();

    expect(bookings.filter((b) => b.customerCategory)).toHaveLength(1);
    expect(bookings.filter((b) => !b.customerCategory)).toHaveLength(4);
    expect(inventoryitems.some((i) => i.pricing.legacy === null)).toBe(true);
  });
});
