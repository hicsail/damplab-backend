import { gql, resetDb, startTestApp, stopTestApp, TestApp } from './harness';

describe('integration harness', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp(ctx);
  });
  beforeEach(async () => {
    await resetDb(ctx);
  });

  it('boots the app and answers a GraphQL query', async () => {
    const data = await gql(ctx, 'staff', '{ __typename }');
    expect(data.__typename).toBe('Query');
  });
});
