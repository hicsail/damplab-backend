import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UsageBillingResult, UsageInvoice, UsageSow } from './usage-billing.model';
import { UsageBillingService } from './usage-billing.service';
import { BillableOwner, GenerateUsageBillingInput } from './dtos/usage-billing.dto';
import { BookingService } from '../booking/booking.service';
import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

/** Staff-only usage billing: pick a user, review their unbilled usage, generate a SOW + invoice. */
@Resolver()
@UseGuards(AuthRolesGuard)
@Roles(Role.DamplabStaff)
export class UsageBillingResolver {
  constructor(
    private readonly usageBillingService: UsageBillingService,
    private readonly bookingService: BookingService
  ) {}

  @Query(() => [BillableOwner], { description: 'Users with confirmed, unbilled inventory usage.' })
  async billableOwners(): Promise<BillableOwner[]> {
    return this.bookingService.getBillableOwners();
  }

  @Mutation(() => UsageBillingResult, { description: 'Generate a usage SOW + invoice from selected bookings; marks them billed.' })
  async generateUsageBilling(@Args('input', { type: () => GenerateUsageBillingInput }) input: GenerateUsageBillingInput, @CurrentUser() user: User): Promise<UsageBillingResult> {
    const createdBy = user?.preferred_username || user?.email || 'staff';
    return this.usageBillingService.generateBilling(input, createdBy);
  }

  @Query(() => [UsageSow], { description: 'Usage SOWs (optionally for one user).' })
  async usageSows(@Args('ownerSub', { type: () => ID, nullable: true }) ownerSub?: string): Promise<UsageSow[]> {
    return this.usageBillingService.findSows(ownerSub);
  }

  @Query(() => [UsageInvoice], { description: 'Usage invoices (optionally for one user).' })
  async usageInvoices(@Args('ownerSub', { type: () => ID, nullable: true }) ownerSub?: string): Promise<UsageInvoice[]> {
    return this.usageBillingService.findInvoices(ownerSub);
  }

  @Query(() => UsageSow, { nullable: true })
  async usageSow(@Args('id', { type: () => ID }) id: string): Promise<UsageSow | null> {
    return this.usageBillingService.sowById(id);
  }

  @Query(() => UsageInvoice, { nullable: true })
  async usageInvoice(@Args('id', { type: () => ID }) id: string): Promise<UsageInvoice | null> {
    return this.usageBillingService.invoiceById(id);
  }
}
