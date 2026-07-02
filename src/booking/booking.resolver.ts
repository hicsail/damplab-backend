import { Args, Float, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { Booking } from './booking.model';
import { BookingService } from './booking.service';
import { CreateBookingInput } from './dtos/create-booking.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

@Resolver(() => Booking)
@UseGuards(AuthRolesGuard)
export class BookingResolver {
  constructor(private readonly bookingService: BookingService) {}

  private isStaff(user?: User): boolean {
    return !!user?.realm_access?.roles?.includes(Role.DamplabStaff);
  }

  private displayName(user?: User): string | undefined {
    return user?.preferred_username || user?.email || undefined;
  }

  /** Any authenticated user can book. Non-staff always book for themselves; staff may set the owner. */
  @Mutation(() => Booking)
  async createBooking(@Args('input', { type: () => CreateBookingInput }) input: CreateBookingInput, @CurrentUser() user: User): Promise<Booking> {
    const cleaned: CreateBookingInput = { ...input };
    if (!this.isStaff(user)) {
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

  /** All bookings (staff calendar/scheduling), optionally filtered by date range + item. */
  @Query(() => [Booking], { description: 'All bookings (staff). Optional date-range + item filters.' })
  @Roles(Role.DamplabStaff)
  async bookings(
    @Args('from', { nullable: true }) from?: Date,
    @Args('to', { nullable: true }) to?: Date,
    @Args('inventoryItemId', { type: () => ID, nullable: true }) inventoryItemId?: string
  ): Promise<Booking[]> {
    return this.bookingService.findAll({ from, to, inventoryItemId });
  }

  /** Confirmed-but-unbilled usage for a user — candidates for a usage SOW/invoice. */
  @Query(() => [Booking], { description: "A user's confirmed, unbilled usage (staff billing)." })
  @Roles(Role.DamplabStaff)
  async billableBookings(@Args('ownerSub') ownerSub: string): Promise<Booking[]> {
    return this.bookingService.findBillableForOwner(ownerSub);
  }

  /** Confirm actual usage (seeds from the booking); required before billing. Staff only. */
  @Mutation(() => Booking)
  @Roles(Role.DamplabStaff)
  async confirmBookingUsage(
    @Args('id', { type: () => ID }) id: string,
    @Args('actualHours', { type: () => Float, nullable: true }) actualHours: number | null,
    @Args('actualQuantity', { type: () => Int, nullable: true }) actualQuantity: number | null,
    @CurrentUser() user: User
  ): Promise<Booking> {
    return this.bookingService.confirmUsage(id, actualHours ?? null, actualQuantity ?? null, this.displayName(user));
  }

  /** Cancel a booking. Owner or staff only. */
  @Mutation(() => Booking)
  async cancelBooking(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: User): Promise<Booking> {
    const booking = await this.bookingService.findById(id);
    if (!booking) throw new NotFoundException('Booking not found.');
    if (!this.isStaff(user) && booking.ownerSub !== user?.sub) {
      throw new ForbiddenException('You can only cancel your own bookings.');
    }
    return this.bookingService.cancel(id);
  }
}
