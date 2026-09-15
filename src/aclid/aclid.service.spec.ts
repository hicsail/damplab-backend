import { HttpException } from '@nestjs/common';
import { AclidService } from './aclid.service';

describe('AclidService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.ACLID_API_URL = 'https://api.aclid.bio';
    process.env.ACLID_API_KEY = 'test-key';
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.ACLID_API_URL;
    delete process.env.ACLID_API_KEY;
  });

  it('isConfigured is false without a key', () => {
    delete process.env.ACLID_API_KEY;
    expect(new AclidService().isConfigured()).toBe(false);
  });

  it('screenInline posts the sequences and returns the succeeded screen', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [{ id: 'scr_1', status: 'queued' }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'scr_1',
            status: 'succeeded',
            regulatory_status: 'not_controlled',
            verification_status: 'missing_verification',
            decision_status: 'awaiting',
            findings: {}
          })
      });

    const record = await new AclidService().screenInline({
      name: 'job-1',
      sequences: [{ name: 'insert', sequence: 'A'.repeat(32) }]
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.aclid.bio/v2/screen_inline');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('test-key');
    expect(record.id).toBe('scr_1');
    expect(record.regulatoryStatus).toBe('not_controlled');
  });

  it('createVerificationUrl returns the hosted url', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ url: 'https://verify.aclid.bio/x' })
    });
    const url = await new AclidService().createVerificationUrl({
      screenId: 'scr_1',
      redirectUrl: 'http://localhost:5173/client_view/job-1'
    });
    expect(url).toBe('https://verify.aclid.bio/x');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      screen_id: 'scr_1',
      redirect_url: 'http://localhost:5173/client_view/job-1'
    });
  });

  it('throws when Aclid returns a non-OK body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => JSON.stringify({ detail: 'nope' })
    });
    await expect(new AclidService().createVerificationUrl({ screenId: 'scr_1' })).rejects.toBeInstanceOf(HttpException);
  });
});
