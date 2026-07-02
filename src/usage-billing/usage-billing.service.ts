import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  UsageBillingResult,
  UsageInvoice,
  UsageInvoiceDocument,
  UsageLineItem,
  UsageSow,
  UsageSowDocument
} from './usage-billing.model';
import { GenerateUsageBillingInput } from './dtos/usage-billing.dto';
import { BookingService } from '../booking/booking.service';
import { Booking, BookingBillingStatus, BookingKind, BookingStatus } from '../booking/booking.model';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const DEFAULT_TERMS =
  'Net 30. This statement covers inventory/equipment usage logged at DAMPLab for the period indicated. Rates are applied per the customer category on file.';

@Injectable()
export class UsageBillingService {
  constructor(
    @InjectModel(UsageSow.name) private readonly sowModel: Model<UsageSowDocument>,
    @InjectModel(UsageInvoice.name) private readonly invoiceModel: Model<UsageInvoiceDocument>,
    private readonly bookingService: BookingService
  ) {}

  private async nextNumber(model: Model<any>, prefix: string): Promise<string> {
    const count = await model.countDocuments().exec();
    return `${prefix}${String(count + 1).padStart(3, '0')}`;
  }

  private lineDetail(b: Booking): string {
    const rate = b.rateSnapshot;
    if (b.kind === BookingKind.TIMED) {
      const hours = b.actualHours ?? (b.startTime && b.endTime ? (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 3_600_000 : 0);
      const h = round2(hours);
      return rate != null ? `${h} hr${h === 1 ? '' : 's'} @ $${rate.toFixed(2)}/hr` : `${h} hr${h === 1 ? '' : 's'}`;
    }
    const qty = b.actualQuantity ?? b.quantity ?? 0;
    return rate != null ? `${qty} unit${qty === 1 ? '' : 's'} @ $${rate.toFixed(2)}/unit` : `${qty} unit${qty === 1 ? '' : 's'}`;
  }

  private toLineItem(b: any): UsageLineItem {
    return {
      bookingId: String(b._id),
      label: b.inventoryName || 'Inventory item',
      detail: this.lineDetail(b),
      usedAt: (b.usedOn || b.startTime) ? new Date(b.usedOn || b.startTime).toISOString() : undefined,
      cost: round2(b.cost ?? 0)
    };
  }

  /** Generate a usage SOW + invoice from selected confirmed/unbilled bookings for one owner. */
  async generateBilling(input: GenerateUsageBillingInput, createdBy: string): Promise<UsageBillingResult> {
    if (!input.bookingIds?.length) throw new BadRequestException('Select at least one usage line item.');

    const bookings = (await this.bookingService.getByIds(input.bookingIds)) as any[];
    if (bookings.length !== input.bookingIds.length) throw new BadRequestException('Some selected bookings could not be found.');

    for (const b of bookings) {
      if (b.ownerSub !== input.ownerSub) throw new BadRequestException('All selected bookings must belong to the same user.');
      if (b.status === BookingStatus.CANCELLED) throw new BadRequestException('A selected booking is cancelled.');
      if (!b.usageConfirmed) throw new BadRequestException(`Usage for "${b.inventoryName}" must be confirmed before billing.`);
      if (b.billingStatus === BookingBillingStatus.BILLED) throw new BadRequestException(`"${b.inventoryName}" has already been billed.`);
    }

    const first = bookings[0];
    const billToName = first.ownerName || first.ownerEmail;
    const billToEmail = first.ownerEmail;
    const billToInstitution = input.billToInstitution || first.ownerInstitution || undefined;
    const customerCategory = first.customerCategory || undefined;

    const lineItems = bookings.map((b) => this.toLineItem(b));
    const totalCost = round2(lineItems.reduce((sum, li) => sum + (li.cost || 0), 0));

    const sowNumber = await this.nextNumber(this.sowModel, 'USAGE-SOW-');
    const sow = await this.sowModel.create({
      sowNumber,
      date: new Date(),
      title: input.title || 'Inventory & Equipment Usage',
      billToSub: input.ownerSub,
      billToName,
      billToEmail,
      billToInstitution,
      customerCategory,
      lineItems,
      totalCost,
      terms: input.terms || DEFAULT_TERMS,
      additionalInformation: input.additionalInformation,
      createdBy,
      createdAt: new Date()
    });

    const invoiceNumber = await this.nextNumber(this.invoiceModel, 'USAGE-INV-');
    const invoice = await this.invoiceModel.create({
      invoiceNumber,
      invoiceDate: new Date(),
      sowId: String(sow._id),
      billToSub: input.ownerSub,
      billToName,
      billToEmail,
      billToInstitution,
      customerCategory,
      lineItems,
      totalCost,
      createdBy,
      createdAt: new Date()
    });

    await this.bookingService.markBilled(input.bookingIds, String(sow._id), String(invoice._id));

    return { sow, invoice };
  }

  async findSows(ownerSub?: string): Promise<UsageSow[]> {
    return this.sowModel.find(ownerSub ? { billToSub: ownerSub } : {}).sort({ createdAt: -1 }).exec();
  }

  async findInvoices(ownerSub?: string): Promise<UsageInvoice[]> {
    return this.invoiceModel.find(ownerSub ? { billToSub: ownerSub } : {}).sort({ createdAt: -1 }).exec();
  }

  async sowById(id: string): Promise<UsageSow | null> {
    return this.sowModel.findById(id).exec();
  }

  async invoiceById(id: string): Promise<UsageInvoice | null> {
    return this.invoiceModel.findById(id).exec();
  }
}
