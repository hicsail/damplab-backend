import { JobPaymentResolver } from './job-payment.resolver';
import { User } from '../auth/user.interface';

/**
 * A payment recorded or voided reissues the job's invoice, and the customer
 * hears about it once: the new version's announcement names the payment. The
 * separate receipt is only for a job with no invoice standing.
 */

const staff = { sub: 'staff-sub', email: 'tech@bu.edu', realm_access: { roles: ['damplab-staff'] } } as unknown as User;

function harness(reissued: any): { resolver: JobPaymentResolver; dispatched: any[]; reissues: any[] } {
  const dispatched: any[] = [];
  const reissues: any[] = [];
  const payments: any = {
    record: async (input: any) => ({ _id: 'pay-1', jobId: 'job-1', amount: input.amount, reference: input.reference }),
    voidPayment: async (id: string) => ({ _id: id, jobId: 'job-1', amount: 25 })
  };
  const balances: any = { balance: async () => ({ balanceDue: 75 }) };
  const jobService: any = { findById: async () => ({ _id: 'job-1', name: 'Test job' }) };
  const dispatch: any = { dispatch: (input: any) => dispatched.push(input) };
  const invoices: any = {
    reissueAfterPaymentChange: async (jobId: string, _user: User, lead: string) => {
      reissues.push({ jobId, lead });
      return reissued;
    }
  };
  return { resolver: new JobPaymentResolver(payments, balances, jobService, dispatch, invoices), dispatched, reissues };
}

const input = { jobId: 'job-1', amount: 25, receivedOn: new Date('2026-09-10T12:00:00Z'), reference: 'Check #1042' } as any;

describe('recording a payment', () => {
  it('reissues the invoice, naming the payment, and sends no separate receipt', async () => {
    const { resolver, dispatched, reissues } = harness({ _id: 'inv-2' });
    await resolver.recordJobPayment(input, staff);
    expect(reissues).toEqual([{ jobId: 'job-1', lead: 'A payment of $25.00 (Check #1042) was received.' }]);
    expect(dispatched).toEqual([]);
  });

  it('sends the receipt when no invoice stands to reissue', async () => {
    const { resolver, dispatched } = harness(null);
    await resolver.recordJobPayment(input, staff);
    expect(dispatched).toEqual([expect.objectContaining({ eventType: 'PAYMENT_RECORDED', jobId: 'job-1' })]);
    expect(dispatched[0].message).toContain('Balance now $75.00.');
  });
});

describe('voiding a payment', () => {
  it('reissues the invoice, naming the void and its reason', async () => {
    const { resolver, reissues } = harness({ _id: 'inv-3' });
    await resolver.voidJobPayment('pay-1', ' Cheque bounced ', staff);
    expect(reissues).toEqual([{ jobId: 'job-1', lead: 'A payment of $25.00 was voided (Cheque bounced).' }]);
  });
});
