import { Resolver, Query, Mutation, Args, ID, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards, ForbiddenException } from '@nestjs/common';
import { Invoice } from './invoice.model';
import { InvoiceKind, invoiceKindOf } from './invoice-kind';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceInput } from './dto/create-invoice.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { Job } from '../job/job.model';
import { JobService } from '../job/job.service';
import { Role } from '../auth/roles/roles.enum';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';

@Resolver(() => Invoice)
@UseGuards(AuthRolesGuard)
export class InvoiceResolver {
  constructor(private readonly invoiceService: InvoiceService, private readonly jobService: JobService) {}

  @Query(() => [Invoice], { description: 'List invoices generated for a job. Staff can view any; clients can view their own.' })
  async invoicesByJobId(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<Invoice[]> {
    const job = await this.jobService.findById(jobId);
    if (!job) return [];

    const roles = user.realm_access?.roles ?? [];
    const isStaff = roles.includes(Role.DamplabStaff);
    const isOwner = (job as any).sub === user.sub;
    if (!isStaff && !isOwner) {
      throw new ForbiddenException('You do not have permission to view invoices for this job');
    }

    return this.invoiceService.findByJobId(jobId);
  }

  @Mutation(() => Invoice, { description: 'Staff-only. Issue a statement of everything this job has been charged, less what it has paid.' })
  async createInvoice(@Args('input', { type: () => CreateInvoiceInput }) input: CreateInvoiceInput, @CurrentUser() user: User): Promise<Invoice> {
    return this.invoiceService.createForJob(input, user);
  }

  /**
   * Void an invoice, keeping the record. This changes nothing on the job's
   * charge ledger — a statement's service lines live there, not on the
   * invoice, and holding a line back is voiding its charge, a separate act on
   * `JobChargeService`.
   *
   * Gated on `billing:write` rather than on the bare `damplab-staff` check
   * `createForJob` still hand-rolls: a void reverses a financial record, so it sits
   * a tier above generating one. Do not add a `@Roles` here as well — the guard
   * evaluates both, and a leftover `@Roles` re-denies everyone the permission was
   * meant to admit.
   */
  @Mutation(() => Invoice, { description: 'Void an invoice. The record is kept and renumbering never happens; this changes nothing on the charge ledger.' })
  @RequirePermission(Permission.BillingWrite)
  async voidInvoice(@Args('invoiceId', { type: () => ID }) invoiceId: string, @Args('reason', { type: () => String }) reason: string, @CurrentUser() user: User): Promise<Invoice> {
    return this.invoiceService.voidInvoice(invoiceId, reason, user);
  }

  @ResolveField(() => Job, { description: 'Job this invoice is associated with' })
  async job(@Parent() invoice: Invoice): Promise<Job | null> {
    return this.jobService.findById((invoice as any).jobId);
  }

  /**
   * `kind` over the wire, non-null, for every invoice including the legacy ones
   * that carry no stored value. This is not cosmetic: without it a non-nullable
   * field on a `required: false` prop is a runtime GraphQL error on every legacy
   * invoice, which would break the existing Invoices card and not just the new
   * equipment layout.
   */
  @ResolveField(() => InvoiceKind, { description: 'What this invoice bills. Invoices written before equipment invoicing read as SOW.' })
  kind(@Parent() invoice: Invoice): InvoiceKind {
    return invoiceKindOf(invoice as any);
  }
}
