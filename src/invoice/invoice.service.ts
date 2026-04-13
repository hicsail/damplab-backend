import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice, InvoiceDocument } from './invoice.model';
import { CreateInvoiceInput } from './dto/create-invoice.input';
import { JobService } from '../job/job.service';
import { SOWService } from '../sow/sow.service';
import { User } from '../auth/user.interface';
import { Role } from '../auth/roles/roles.enum';

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

@Injectable()
export class InvoiceService {
  constructor(@InjectModel(Invoice.name) private readonly invoiceModel: Model<InvoiceDocument>, private readonly jobService: JobService, private readonly sowService: SOWService) {}

  async findByJobId(jobId: string): Promise<Invoice[]> {
    return this.invoiceModel.find({ jobId }).sort({ createdAt: -1 }).exec();
  }

  async createForJob(input: CreateInvoiceInput, user: User): Promise<Invoice> {
    const roles = user.realm_access?.roles ?? [];
    const isStaff = roles.includes(Role.DamplabStaff);
    if (!isStaff) {
      throw new ForbiddenException('Only staff can generate invoices');
    }

    const job = await this.jobService.findById(input.jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    }

    const sow = await this.sowService.findByJobId(input.jobId);
    if (!sow) {
      throw new BadRequestException('Cannot generate invoice: job has no SOW');
    }

    const serviceIds = Array.isArray(input.serviceIds) ? input.serviceIds.map(String).filter(Boolean) : [];
    if (!serviceIds.length) {
      throw new BadRequestException('serviceIds must be a non-empty list');
    }

    const sowServices = sow.services ?? [];
    const serviceById = new Map(sowServices.map((s: any) => [String(s.serviceId ?? s._id ?? ''), s]));

    const selected = serviceIds.map((sid) => serviceById.get(String(sid))).filter(Boolean) as any[];
    if (!selected.length) {
      throw new BadRequestException('No matching services found in SOW for provided serviceIds');
    }

    const totalCost = selected.reduce((sum, s) => sum + (Number(s.cost) || 0), 0);

    // Generate next invoice number per job: "<jobDisplayId>-<seq>"
    const existingCount = await this.invoiceModel.countDocuments({ jobId: input.jobId }).exec();
    const seq = existingCount + 1;
    const jobDisplayId = String((job as any).jobId ?? job._id);
    const invoiceNumber = `${jobDisplayId}-${pad3(seq)}`;

    const createdBy = user.email || user.preferred_username || 'unknown';

    const invoice = await this.invoiceModel.create({
      job: (job as any)._id,
      jobId: String((job as any)._id),
      jobDisplayId,
      jobName: (job as any).name ?? '',
      invoiceNumber,
      invoiceDate: new Date(),
      createdBy,
      services: selected.map((s: any) => ({
        _id: String(s.serviceId ?? s._id),
        serviceId: String(s.serviceId ?? s._id),
        name: String(s.name ?? 'Service'),
        description: String(s.description ?? ''),
        cost: Number(s.cost) || 0,
        category: String(s.category ?? '')
      })),
      totalCost,
      billedToName: String((sow as any).clientName ?? 'Client'),
      billedToEmail: String((sow as any).clientEmail ?? ''),
      billedToAddress: (sow as any).clientAddress ?? undefined,
      customerCategory: (job as any).customerCategory ?? undefined,
      createdAt: new Date()
    });

    return invoice;
  }
}
