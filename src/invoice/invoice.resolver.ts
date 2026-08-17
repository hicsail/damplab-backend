import { Resolver, Query, Mutation, Args, ID, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards, ForbiddenException } from '@nestjs/common';
import { Invoice } from './invoice.model';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceInput } from './dto/create-invoice.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { Job } from '../job/job.model';
import { JobService } from '../job/job.service';
import { Role } from '../auth/roles/roles.enum';

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

  @Mutation(() => Invoice, { description: 'Staff-only. Generate a new invoice for a job by selecting a subset of services from the job SOW.' })
  async createInvoice(@Args('input', { type: () => CreateInvoiceInput }) input: CreateInvoiceInput, @CurrentUser() user: User): Promise<Invoice> {
    return this.invoiceService.createForJob(input, user);
  }

  @ResolveField(() => Job, { description: 'Job this invoice is associated with' })
  async job(@Parent() invoice: Invoice): Promise<Job | null> {
    return this.jobService.findById((invoice as any).jobId);
  }
}
