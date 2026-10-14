import { hiddenServiceNames } from './hidden-service-gate';

const workflows = (...services: Array<{ name: string; hiddenFromClients?: boolean }>): any[] => [{ nodes: services.map((service) => ({ service })) }];

describe('retired operations on a new job', () => {
  it('lists each hidden service once', () => {
    expect(hiddenServiceNames(workflows({ name: 'Old', hiddenFromClients: true }, { name: 'Old', hiddenFromClients: true }, { name: 'PCR' }))).toEqual(['Old']);
  });

  it('ignores operations that are still offered', () => {
    expect(hiddenServiceNames(workflows({ name: 'PCR', hiddenFromClients: false }))).toEqual([]);
    expect(hiddenServiceNames(undefined)).toEqual([]);
  });
});
