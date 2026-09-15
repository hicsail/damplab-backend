import { Resolver, Query, Mutation, Args, ID, Int, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards, ForbiddenException } from '@nestjs/common';
import { Invoice } from './invoice.model';
import { InvoiceKind, InvoiceStatus, invoiceKindOf, invoiceStatusFromDocument, invoiceVersionOf, paidStatus } from './invoice-kind';
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
import { JobPaymentService } from '../job-payment/job-payment.service';
import { ActivityService } from '../activity/activity.service';
import { ActivityEventType } from '../activity/activity-event.model';

@Resolver(() => Invoice)
@UseGuards(AuthRolesGuard)
export class InvoiceResolver {
  constructor(private readonly invoiceService: InvoiceService, private readonly jobService: JobService, private readonly payments: JobPaymentService, private readonly activityService: ActivityService) {}

  @Query(() => [Invoice], { description: "A job's invoices, newest first: the current version and its history. Staff can view any; clients can view their own." })
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

  @Mutation(() => Invoice, { description: "Staff-only. Issue a new version of the job's invoice, superseding the previous one." })
  async createInvoice(@Args('input', { type: () => CreateInvoiceInput }) input: CreateInvoiceInput, @CurrentUser() user: User): Promise<Invoice> {
    const invoice = await this.invoiceService.createForJob(input, user);
    await this.activityService.createEvent({
      type: ActivityEventType.INVOICE_GENERATED,
      message: `Invoice ${(invoice as any).invoiceNumber ?? ''} generated`,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined,
      jobId: (invoice as any).jobId,
      invoiceId: String((invoice as any)._id),
      invoiceNumber: (invoice as any).invoiceNumber
    });
    return invoice;
  }

  /**
   * What `createInvoice` would issue with this input, written nowhere — the
   * issue dialog renders it as the invoice the customer will see. Gated like a
   * write: it reads the whole job's billing, and exists only to prepare one.
   */
  @Query(() => Invoice, { description: 'Staff-only. The invoice createInvoice would issue with this input, without writing anything. Carries the default due dates when the input gives none.' })
  @RequirePermission(Permission.BillingWrite)
  async invoicePreview(@Args('input', { type: () => CreateInvoiceInput }) input: CreateInvoiceInput, @CurrentUser() user: User): Promise<Invoice> {
    return this.invoiceService.previewForJob(input, user);
  }

  /**
   * Void the job's current invoice, keeping the record — for a job that was
   * cancelled or changed. Nothing else moves: the job's charges and payments
   * stay, and the next version restates them.
   *
   * Gated on `billing:write` rather than on the bare `damplab-staff` check
   * `createForJob` still hand-rolls: a void reverses a financial record, so it sits
   * a tier above generating one. Do not add a `@Roles` here as well — the guard
   * evaluates both, and a leftover `@Roles` re-denies everyone the permission was
   * meant to admit.
   */
  @Mutation(() => Invoice, { description: "Void the job's current invoice. The record is kept and renumbering never happens." })
  @RequirePermission(Permission.BillingWrite)
  async voidInvoice(@Args('invoiceId', { type: () => ID }) invoiceId: string, @Args('reason', { type: () => String }) reason: string, @CurrentUser() user: User): Promise<Invoice> {
    const invoice = await this.invoiceService.voidInvoice(invoiceId, reason, user);
    await this.activityService.createEvent({
      type: ActivityEventType.INVOICE_VOIDED,
      message: `Invoice ${(invoice as any).invoiceNumber ?? ''} voided`,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined,
      jobId: (invoice as any).jobId,
      invoiceId: String((invoice as any)._id),
      invoiceNumber: (invoice as any).invoiceNumber
    });
    return invoice;
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

  /**
   * Derived, never stored: PAID has to follow payments recorded after the
   * invoice was issued. Void and superseded are decided from the document, so
   * only the current invoice costs a payments read.
   */
  @ResolveField(() => InvoiceStatus, {
    description: 'ISSUED, PAID, SUPERSEDED or VOID. PAID only for the current invoice, once the payments recorded on the job cover its charges.'
  })
  async status(@Parent() invoice: Invoice): Promise<InvoiceStatus> {
    const fromDocument = invoiceStatusFromDocument(invoice as any);
    if (fromDocument) return fromDocument;
    const paid = await this.payments.paymentsToDate(String((invoice as any).jobId));
    return paidStatus(Number((invoice as any).subtotal) || 0, paid);
  }

  @ResolveField(() => Int, { nullable: true, description: "Which version of the job's invoice this is. Read off the invoice number on documents issued before versioning." })
  versionNumber(@Parent() invoice: Invoice): number | null {
    return invoiceVersionOf(invoice as any);
  }
}
