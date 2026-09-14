import { gql, resetDb, seedService, startTestApp, stopTestApp, TestApp } from './harness';

/**
 * A bundle that runs the same operation at two points in its sequence.
 *
 * This needs a database because the claim being made is about a round trip, not
 * a reducer: `Bundle.services` is a plain `ObjectId[]`, the create/update pipes
 * validate each id without normalizing the array, and the field resolver goes
 * through `DampLabServices.findByIds`, which maps over the ids it was given
 * rather than resolving a `$in` set. Every one of those has to keep duplicates
 * and order for the steps editor to mean anything — and the unit tests around
 * the editor exercise none of them.
 */

jest.setTimeout(60000);

const CREATE_BUNDLE = `
  mutation CreateBundle($bundle: CreateBundle!) {
    createBundle(bundle: $bundle) {
      id
      label
      services { id name }
    }
  }
`;

const UPDATE_BUNDLE = `
  mutation UpdateBundle($bundle: ID!, $changes: BundleChange!) {
    updateBundle(bundle: $bundle, changes: $changes) {
      id
      services { id name }
    }
  }
`;

const GET_BUNDLES = `
  query {
    bundles { id label services { id name } }
  }
`;

describe('a bundle whose steps repeat an operation', () => {
  let testApp: TestApp;
  let pcr: string;
  let gel: string;

  beforeAll(async () => {
    testApp = await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp(testApp);
  });

  beforeEach(async () => {
    await resetDb(testApp);
    pcr = await seedService(testApp, { name: 'PCR' });
    gel = await seedService(testApp, { name: 'Gel Electrophoresis' });
  });

  it('stores and returns the same operation twice, in the order it was given', async () => {
    const created = await gql(testApp, 'staff', CREATE_BUNDLE, {
      bundle: { label: 'Cloning', icon: '', services: [pcr, gel, pcr] }
    });

    expect(created.createBundle.services.map((s: any) => s.name)).toEqual(['PCR', 'Gel Electrophoresis', 'PCR']);
  });

  it('survives a re-read, so the repeat is stored and not just echoed back', async () => {
    await gql(testApp, 'staff', CREATE_BUNDLE, { bundle: { label: 'Cloning', icon: '', services: [pcr, gel, pcr] } });

    const { bundles } = await gql(testApp, 'staff', GET_BUNDLES);

    expect(bundles).toHaveLength(1);
    expect(bundles[0].services.map((s: any) => s.id)).toEqual([pcr, gel, pcr]);
  });

  it('keeps a repeat through an edit that reorders the steps', async () => {
    const created = await gql(testApp, 'staff', CREATE_BUNDLE, {
      bundle: { label: 'Cloning', icon: '', services: [pcr, gel, pcr] }
    });

    const updated = await gql(testApp, 'staff', UPDATE_BUNDLE, {
      bundle: created.createBundle.id,
      changes: { services: [pcr, pcr, gel] }
    });

    expect(updated.updateBundle.services.map((s: any) => s.id)).toEqual([pcr, pcr, gel]);
  });

  it('still refuses an operation that does not exist, duplicates or not', async () => {
    // The validation pipe walks every entry, so a repeat must not let a bad id
    // through on its second appearance.
    const bad = '0'.repeat(24);
    const response = await gql(testApp, 'staff', GET_BUNDLES);
    expect(response.bundles).toEqual([]);

    await expect(gql(testApp, 'staff', CREATE_BUNDLE, { bundle: { label: 'Bad', icon: '', services: [pcr, bad] } })).rejects.toThrow();
  });
});
