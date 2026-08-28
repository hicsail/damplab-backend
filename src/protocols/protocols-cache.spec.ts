import { ProtocolsService, ProtocolView } from './protocols.service';

/**
 * The cache is what makes the Protocol Library page viable at all: it assembles
 * every protocol referenced by the service catalog, so an uncached page load is one
 * protocols.io round trip per protocol — two, counting steps — against a
 * rate-limited API on one shared server-side key.
 */
describe('ProtocolsService — the TTL cache', () => {
  const serviceWith = (fetchImpl: jest.Mock): ProtocolsService => {
    const service = new ProtocolsService({ get: () => 'test-key' } as any);
    // Replace the network half only; the caching wrapper is what is under test.
    (service as any).fetchProtocol = fetchImpl;
    return service;
  };

  const protocol = (id: string): ProtocolView => ({ id, title: `Protocol ${id}`, url: '', description: '', steps: [] });

  it('fetches once and serves the rest from memory', async () => {
    const fetchProtocol = jest.fn(async (id: string) => protocol(id));
    const service = serviceWith(fetchProtocol);

    await service.getProtocol('abc');
    await service.getProtocol('abc');
    await service.getProtocol('abc');

    expect(fetchProtocol).toHaveBeenCalledTimes(1);
  });

  it('keys per protocol, so one hot protocol does not mask another', async () => {
    const fetchProtocol = jest.fn(async (id: string) => protocol(id));
    const service = serviceWith(fetchProtocol);

    await service.getProtocol('abc');
    await service.getProtocol('def');

    expect(fetchProtocol).toHaveBeenCalledTimes(2);
  });

  it('re-fetches once the entry has expired', async () => {
    const fetchProtocol = jest.fn(async (id: string) => protocol(id));
    const service = serviceWith(fetchProtocol);

    await service.getProtocol('abc');
    // Reach in and expire it rather than waiting ten real minutes.
    (service as any).protocolCache.get('abc').expiresAt = Date.now() - 1;
    await service.getProtocol('abc');

    expect(fetchProtocol).toHaveBeenCalledTimes(2);
  });

  it('re-fetches after an explicit invalidate', async () => {
    const fetchProtocol = jest.fn(async (id: string) => protocol(id));
    const service = serviceWith(fetchProtocol);

    await service.getProtocol('abc');
    service.invalidateProtocol('abc');
    await service.getProtocol('abc');

    expect(fetchProtocol).toHaveBeenCalledTimes(2);
  });

  it('stays bounded, so a long-running process cannot grow it without limit', async () => {
    const fetchProtocol = jest.fn(async (id: string) => protocol(id));
    const service = serviceWith(fetchProtocol);

    for (let i = 0; i < 600; i += 1) {
      await service.getProtocol(`protocol-${i}`);
    }

    expect((service as any).protocolCache.size).toBeLessThanOrEqual(500);
  });

  it('does not cache a failure — a transient upstream error must not stick', async () => {
    const fetchProtocol = jest.fn(async (id: string) => {
      if (fetchProtocol.mock.calls.length === 1) throw new Error('upstream down');
      return protocol(id);
    });
    const service = serviceWith(fetchProtocol);

    await expect(service.getProtocol('abc')).rejects.toThrow('upstream down');
    await expect(service.getProtocol('abc')).resolves.toEqual(protocol('abc'));
  });
});
