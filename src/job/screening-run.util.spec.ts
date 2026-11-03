import { model, Types } from 'mongoose';
import { ScreeningRunSchema } from './screening-run.model';
import { HomologyScreeningStatus } from './job.model';
import { fitAclidLeg } from './screening-run.util';

const leg = (raw: Record<string, unknown>, details: Record<string, unknown> | null): any => ({ screenId: 'scr_1', homologyStatus: HomologyScreeningStatus.PASSED, raw, details, detail: null });

describe('fitAclidLeg', () => {
  it('leaves a leg under the bound exactly as it is', () => {
    const small = leg({ id: 'scr_1', sequences: { a: {} } }, { a: { matches: [] } });
    expect(fitAclidLeg(small, 10_000)).toBe(small);
  });

  it('drops raw.sequences first when details carry the same map', () => {
    const big = 'x'.repeat(600);
    const fitted = fitAclidLeg(leg({ id: 'scr_1', sequences: { a: big } }, { a: { matches: [] } }), 500);
    expect(fitted.raw).toEqual({ id: 'scr_1' });
    expect(fitted.details).toEqual({ a: { matches: [] } });
    expect(fitted.detail).toBeNull();
  });

  it('drops the details, and says so, when still too large', () => {
    const fitted = fitAclidLeg(leg({ id: 'scr_1' }, { a: 'x'.repeat(600) }), 500);
    expect(fitted.details).toBeNull();
    expect(fitted.detail).toBe('Aclid details too large to store');
  });
});

describe('ScreeningRunSchema', () => {
  it('keeps empty findings, empty details and the leg itself', () => {
    const Model = model('ScreeningRunMinimizeCheck', ScreeningRunSchema);
    const obj: any = new Model({
      jobId: new Types.ObjectId(),
      trigger: 'RERUN',
      status: HomologyScreeningStatus.PASSED,
      startedAt: new Date(),
      aclid: { homologyStatus: HomologyScreeningStatus.PASSED, findings: {}, details: {}, raw: {}, materialSummary: {} }
    }).toObject();
    expect(obj.aclid).toBeDefined();
    expect(obj.aclid.findings).toEqual({});
    expect(obj.aclid.details).toEqual({});
  });
});
