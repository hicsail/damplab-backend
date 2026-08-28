import { Args, Float, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { Booking } from './booking.model';
import { BookingService } from './booking.service';
import { CreateBookingInput } from './dtos/create-booking.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission } from '../auth/permissions/permissions';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

@Resolver(() => Booking)
@UseGuards(AuthRolesGuard)
export class BookingResolver {
  constructor(private readonly bookingService: BookingService) {}

  /**
   * "May set another user's details on a booking, and may cancel anyone's."
   *
   * Re-pointed off the raw `damplab-staff` role check: leaving it on the role while
   * the resolvers move to permissions gives the codebase two disagreeing definitions
   * of staff. `inventory:write` is Administrator-only, so this is behaviourally
   * identical to what it replaced.
   *
   * Deliberately NOT `inventory:schedule`. The matrix now grants that to equipment
   * users so they can reach the lab-wide calendar, and reaching a calendar is not
   * authority over other people's slots — which is why `cancelBooking` keeps its
   * per-booking ownership check below.
   */
  private canManageOthersBookings(user?: User): boolean {
    return hasPermission(user, Permission.InventoryWrite);
  }

  private displayName(user?: User): string | undefined {
    return user?.preferred_username || user?.email || undefined;
  }

  /**
   * Any authenticated user can book — deliberately left open, as the checklist's
   * regression floor requires. Callers who cannot manage others' bookings always
   * book for themselves; owner overrides from the client are dropped.
   */
  @Mutation(() => Booking)
  async createBooking(@Args('input', { type: () => CreateBookingInput }) input: CreateBookingInput, @CurrentUser() user: User): Promise<Booking> {
    const cleaned: CreateBookingInput = { ...input };
    if (!this.canManageOthersBookings(user)) {
      // Force self-ownership for non-staff (ignore any owner overrides from the client).
      cleaned.ownerSub = undefined;
      cleaned.ownerEmail = undefined;
      cleaned.ownerName = undefined;
      cleaned.ownerInstitution = undefined;
    }
    return this.bookingService.create(cleaned, { sub: user?.sub, email: user?.email, name: this.displayName(user) });
  }

  /** The current user's own bookings. */
  @Query(() => [Booking], { description: 'Bookings owned by the current user.' })
  async myBookings(@CurrentUser() user: User): Promise<Booking[]> {
    if (!user?.sub) return [];
    return this.bookingService.findByOwner(user.sub);
  }

  /**
   * All bookings — the lab-wide schedule and the availability board.
   *
   * `inventory:read` rather than `inventory:schedule`: /inventory needs it too, and
   * nobody holds schedule without read, so this covers both rows of the widening
   * table without over-granting.
   */
  @Query(() => [Booking], { description: 'All bookings. Optional date-range + item filters. Requires inventory:read.' })
  @RequirePermission(Permission.InventoryRead)
  async bookings(
    @Args('from', { nullable: true }) from?: Date,
    @Args('to', { nullable: true }) to?: Date,
    @Args('inventoryItemId', { type: () => ID, nullable: true }) inventoryItemId?: string
  ): Promise<Booking[]> {
    return this.bookingService.findAll({ from, to, inventoryItemId });
  }

  /** Confirmed-but-unbilled usage for a user — candidates for a usage SOW/invoice. */
  @Query(() => [Booking], { description: "A user's confirmed, unbilled usage (billing)." })
  @RequirePermission(Permission.BillingView)
  async billableBookings(@Args('ownerSub') ownerSub: string): Promise<Booking[]> {
    return this.bookingService.findBillableForOwner(ownerSub);
  }

  /**
   * Confirm actual usage (seeds from the booking); required before billing.
   *
   * Deliberately `billing:view` (Administrator-only) and NOT `inventory:schedule`,
   * even though the control lives on the schedule page that equipment users can now
   * reach. Confirming usage is a billing act, not a scheduling one: it is what makes
   * a booking chargeable. Widening it is a separate decision the lab should make
   * explicitly rather than one that rides along on a visibility request.
   */
  @Mutation(() => Booking)
  @RequirePermission(Permission.BillingView)
  async confirmBookingUsage(
    @Args('id', { type: () => ID }) id: string,
    @Args('actualHours', { type: () => Float, nullable: true }) actualHours: number | null,
    @Args('actualQuantity', { type: () => Int, nullable: true }) actualQuantity: number | null,
    @CurrentUser() user: User
  ): Promise<Booking> {
    return this.bookingService.confirmUsage(id, actualHours ?? null, actualQuantity ?? null, this.displayName(user));
  }

  /**
   * Cancel a booking. Owner only, unless the caller may manage others' bookings.
   * The ownership check is the real gate — an equipment user reaching the lab-wide
   * calendar must not be able to cancel someone else's slot.
   */
  @Mutation(() => Booking)
  async cancelBooking(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: User): Promise<Booking> {
    const booking = await this.bookingService.findById(id);
    if (!booking) throw new NotFoundException('Booking not found.');
    if (!this.canManageOthersBookings(user) && booking.ownerSub !== user?.sub) {
      throw new ForbiddenException('You can only cancel your own bookings.');
    }
    return this.bookingService.cancel(id);
  }
}
