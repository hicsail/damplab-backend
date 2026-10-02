import { JobInvoiceFieldsResolver } from './job-invoice-fields.resolver';
import { InvoiceStatus } from './invoice-kind';

function build(current: any, paid = 0): { resolver: JobInvoiceFieldsResolver; paymentsToDate: jest.Mock } {
  const paymentsToDate = jest.fn(async () => paid);
  const resolver = new JobInvoiceFieldsResolver({ findCurrent: jest.fn(async () => current) } as any, { paymentsToDate } as any);
  return { resolver, paymentsToDate };
}
const job: any = { _id: 'job-1' };

describe('Job.invoiceStatus — what the jobs list shows per row', () => {
  it('is null before an invoice is issued, without reading payments', async () => {
    const { resolver, paymentsToDate } = build(null);
    await expect(resolver.invoiceStatus(job)).resolves.toBeNull();
    expect(paymentsToDate).not.toHaveBeenCalled();
  });

  it('is ISSUED while the job’s payments fall short of the current invoice', async () => {
    await expect(build({ kind: 'STATEMENT', subtotal: 350 }, 100).resolver.invoiceStatus(job)).resolves.toBe(InvoiceStatus.ISSUED);
  });

  it('is PAID once they cover it', async () => {
    const { resolver, paymentsToDate } = build({ kind: 'STATEMENT', subtotal: 350 }, 350);
    await expect(resolver.invoiceStatus(job)).resolves.toBe(InvoiceStatus.PAID);
    expect(paymentsToDate).toHaveBeenCalledWith('job-1');
  });

  it('keeps a legacy invoice ISSUED whatever has been paid, as the Invoice card does', async () => {
    await expect(build({ kind: 'SOW', subtotal: 350 }, 999).resolver.invoiceStatus(job)).resolves.toBe(InvoiceStatus.ISSUED);
  });
});
