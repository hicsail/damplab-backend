import { HttpException } from '@nestjs/common';
import { AclidScreenPendingError, AclidService, mapAclidScreen } from './aclid.service';

const LONG_SEQUENCE = 'A'.repeat(32);

/**
 * A clock the test moves by hand, so a 120 s poll budget can elapse inside a
 * test that takes no time. Each mocked response advances it, which is how a
 * request "spends" part of the budget.
 */
function fakeClock(): { advance: (ms: number) => void; restore: () => void } {
  let now = Date.now();
  const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  return { advance: (ms: number) => void (now += ms), restore: () => spy.mockRestore() };
}

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

  /**
   * The screen is real and Aclid will finish it. The verdict is lost, the
   * handle to it must not be: KYC hangs off this id.
   */
  it('gives up on a screen that outlives the poll budget, but keeps its id', async () => {
    const clock = fakeClock();
    try {
      // 70 s per call, so the create POST and one poll exhaust the 120 s budget.
      fetchMock.mockImplementation(async (url: string): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> => {
        clock.advance(70_000);
        const inline = String(url).includes('screen_inline');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(inline ? { items: [{ id: 'scr_slow', status: 'queued' }] } : { id: 'scr_slow', status: 'running' })
        };
      });

      const error = await new AclidService().screenInline({ name: 'job-1', sequences: [{ name: 'insert', sequence: LONG_SEQUENCE }] }).catch((e) => e);

      expect(error).toBeInstanceOf(AclidScreenPendingError);
      expect((error as AclidScreenPendingError).screen.id).toBe('scr_slow');
      // Create plus one poll: the budget covers the create POST, so a slow
      // create leaves less polling time rather than starting the clock afresh.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      clock.restore();
    }
  });

  it('keeps the screen id when a poll request fails outright', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [{ id: 'scr_2', status: 'queued' }] })
      })
      .mockRejectedValueOnce(new Error('fetch failed'));

    const error = await new AclidService().screenInline({ name: 'job-1', sequences: [{ name: 'insert', sequence: LONG_SEQUENCE }] }).catch((e) => e);

    expect(error).toBeInstanceOf(AclidScreenPendingError);
    expect((error as AclidScreenPendingError).screen.id).toBe('scr_2');
    expect((error as AclidScreenPendingError).message).toContain('could not be read back');
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

  it('mapAclidScreen keeps the report fields the run stores, and the raw body', () => {
    const body = {
      id: 'scr_9',
      status: 'succeeded',
      regulatory_status: 'controlled',
      findings: { us_ccl_export_control: { reason_code: 'toxin', regulatory_status: 'controlled', material: 'Ricin' } },
      match_count: 12,
      material_count: 1,
      length: 960,
      material_summary: { Ricin: { control_type: 'toxin', total_sequences: 2 } },
      sequences: { a: { matches: [], findings: null, regulatory_status: 'not_controlled' } }
    };
    const record = mapAclidScreen(body);
    expect(record).toMatchObject({ matchCount: 12, materialCount: 1, totalLength: 960, materialSummary: { Ricin: { control_type: 'toxin', total_sequences: 2 } } });
    expect(record.raw).toBe(body);
    expect(mapAclidScreen({ id: 'scr_1' })).toMatchObject({ matchCount: null, materialCount: null, totalLength: null, materialSummary: null });
  });

  it('getScreenDetails asks for 25 matches per region and returns the map', async () => {
    const details = { seq_a: { matches: [], findings: null, regulatory_status: 'not_controlled' } };
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify(details) });
    await expect(new AclidService().getScreenDetails('scr_1')).resolves.toEqual(details);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.aclid.bio/v2/screens/scr_1/details?max_match_count_per_region=25');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });

  it('getScreenDetails returns null while Aclid answers 204 (screen not complete)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });
    await expect(new AclidService().getScreenDetails('scr_1')).resolves.toBeNull();
  });

  it('getScreenDetails refuses a body that is not an object', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '[]' });
    await expect(new AclidService().getScreenDetails('scr_1')).rejects.toBeInstanceOf(HttpException);
  });
});
