import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SOW, SOWDocument, SOWStatus, SOWSignature, SOWSignatureRole } from './sow.model';
import { CreateSOWInput } from './dto/create-sow.input';
import { UpdateSOWInput } from './dto/update-sow.input';
import { SubmitSOWSignatureInput } from './dto/submit-sow-signature.input';
import { JobService } from '../job/job.service';
import { Job } from '../job/job.model';
import { User } from '../auth/user.interface';
import { Role } from '../auth/roles/roles.enum';

@Injectable()
export class SOWService {
  constructor(
    @InjectModel(SOW.name) private readonly sowModel: Model<SOWDocument>,
    @Inject(forwardRef(() => JobService))
    private readonly jobService: JobService
  ) {}

  /**
   * Generate the next SOW number in sequence (e.g., "SOW 001", "SOW 002")
   */
  async generateSOWNumber(): Promise<string> {
    // Find the highest SOW number
    const lastSOW = await this.sowModel.findOne({}).sort({ sowNumber: -1 }).exec();

    if (!lastSOW) {
      return 'SOW 001';
    }

    // Extract the number from the last SOW number (e.g., "SOW 059" -> 59)
    const match = lastSOW.sowNumber.match(/SOW\s+(\d+)/i);
    if (!match) {
      // If format is unexpected, start from 001
      return 'SOW 001';
    }

    const lastNumber = parseInt(match[1], 10);
    const nextNumber = lastNumber + 1;

    // Format with zero padding (e.g., 1 -> "001", 59 -> "059")
    return `SOW ${nextNumber.toString().padStart(3, '0')}`;
  }

  /**
   * Validate SOW data
   */
  private validateSOWData(input: CreateSOWInput | UpdateSOWInput): void {
    // Validate scope of work
    if ('scopeOfWork' in input && input.scopeOfWork && input.scopeOfWork.length === 0) {
      throw new BadRequestException('scopeOfWork cannot be empty');
    }

    // Validate deliverables
    if ('deliverables' in input && input.deliverables && input.deliverables.length === 0) {
      throw new BadRequestException('deliverables cannot be empty');
    }

    // Validate services
    if ('services' in input && input.services && input.services.length === 0) {
      throw new BadRequestException('services cannot be empty');
    }

    // Validate timeline
    if ('timeline' in input && input.timeline) {
      const { startDate, endDate } = input.timeline;
      if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
        throw new BadRequestException('endDate must be after startDate');
      }
    }

    // Validate pricing
    if ('pricing' in input && input.pricing) {
      const { baseCost, adjustments, totalCost } = input.pricing;

      if (baseCost !== undefined && baseCost < 0) {
        throw new BadRequestException('baseCost cannot be negative');
      }

      if (totalCost !== undefined && totalCost < 0) {
        throw new BadRequestException('totalCost cannot be negative');
      }

      // Calculate expected total cost
      if (baseCost !== undefined && adjustments && totalCost !== undefined) {
        const adjustmentsTotal = adjustments.reduce((sum, adj) => {
          if (adj.type === 'DISCOUNT') {
            return sum - adj.amount;
          } else if (adj.type === 'ADDITIONAL_COST') {
            return sum + adj.amount;
          }
          return sum;
        }, 0);

        const expectedTotal = baseCost + adjustmentsTotal;
        // Allow small floating point differences (0.01)
        if (Math.abs(expectedTotal - totalCost) > 0.01) {
          throw new BadRequestException(`totalCost (${totalCost}) does not match baseCost (${baseCost}) + adjustments (${adjustmentsTotal})`);
        }
      }
    }
  }

  /**
   * Transform service input to SOWService format
   */
  private transformServices(services: CreateSOWInput['services']): SOW['services'] {
    return services.map((service) => ({
      _id: service.id,
      serviceId: service.id,
      name: service.name,
      description: service.description,
      cost: service.cost,
      category: service.category
    }));
  }

  /**
   * Transform pricing adjustments
   */
  private transformPricingAdjustments(adjustments: CreateSOWInput['pricing']['adjustments']): SOW['pricing']['adjustments'] {
    return adjustments.map((adj) => ({
      _id: adj.type + '-' + Date.now() + '-' + Math.random(),
      type: adj.type,
      description: adj.description,
      amount: adj.amount,
      reason: adj.reason
    }));
  }

  /**
   * Create a new SOW
   */
  async create(createSOWInput: CreateSOWInput): Promise<SOW> {
    // Validate job exists
    const job = await this.jobService.findById(createSOWInput.jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${createSOWInput.jobId} not found`);
    }

    // Check if job already has a SOW
    const existingSOW = await this.sowModel.findOne({ jobId: createSOWInput.jobId }).exec();
    if (existingSOW) {
      throw new BadRequestException(`Job ${createSOWInput.jobId} already has a SOW`);
    }

    // Validate input data
    this.validateSOWData(createSOWInput);

    // Generate SOW number if not provided
    let sowNumber = createSOWInput.sowNumber;
    if (!sowNumber) {
      sowNumber = await this.generateSOWNumber();
    } else {
      // Check if provided SOW number is unique
      const existingSOWWithNumber = await this.sowModel.findOne({ sowNumber }).exec();
      if (existingSOWWithNumber) {
        throw new BadRequestException(`SOW number ${sowNumber} already exists`);
      }
    }

    // Transform services
    const services = this.transformServices(createSOWInput.services);

    // Transform pricing adjustments
    const adjustments = this.transformPricingAdjustments(createSOWInput.pricing.adjustments);

    // Create SOW document
    const sowData = {
      sowNumber,
      date: createSOWInput.date || new Date(),
      job: job._id,
      jobId: job._id.toString(),
      jobName: job.name,
      sowTitle: createSOWInput.sowTitle,
      clientName: createSOWInput.clientName,
      clientEmail: createSOWInput.clientEmail,
      clientInstitution: createSOWInput.clientInstitution,
      clientAddress: createSOWInput.clientAddress,
      scopeOfWork: createSOWInput.scopeOfWork,
      deliverables: createSOWInput.deliverables,
      services,
      timeline: createSOWInput.timeline,
      resources: createSOWInput.resources,
      pricing: {
        baseCost: createSOWInput.pricing.baseCost,
        adjustments,
        totalCost: createSOWInput.pricing.totalCost,
        discount: createSOWInput.pricing.discount
      },
      terms: createSOWInput.terms,
      additionalInformation: createSOWInput.additionalInformation,
      createdBy: createSOWInput.createdBy,
      status: createSOWInput.status || SOWStatus.DRAFT,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const sow = await this.sowModel.create(sowData);
    return sow;
  }

  /**
   * Update an existing SOW
   */
  async update(id: string, updateSOWInput: UpdateSOWInput): Promise<SOW> {
    const sow = await this.sowModel.findById(id).exec();
    if (!sow) {
      throw new NotFoundException(`SOW with ID ${id} not found`);
    }

    // Validate input data
    this.validateSOWData(updateSOWInput);

    // Check SOW number uniqueness if being updated
    if (updateSOWInput.sowNumber && updateSOWInput.sowNumber !== sow.sowNumber) {
      const existingSOWWithNumber = await this.sowModel.findOne({ sowNumber: updateSOWInput.sowNumber }).exec();
      if (existingSOWWithNumber) {
        throw new BadRequestException(`SOW number ${updateSOWInput.sowNumber} already exists`);
      }
    }

    // Transform services if provided
    let services = sow.services;
    if (updateSOWInput.services) {
      services = this.transformServices(updateSOWInput.services);
    }

    // Transform pricing adjustments if provided
    let adjustments = sow.pricing.adjustments;
    if (updateSOWInput.pricing?.adjustments) {
      adjustments = this.transformPricingAdjustments(updateSOWInput.pricing.adjustments);
    }

    // Build update object
    const updateData: any = {
      updatedAt: new Date()
    };

    if (updateSOWInput.sowNumber !== undefined) updateData.sowNumber = updateSOWInput.sowNumber;
    if (updateSOWInput.date !== undefined) updateData.date = updateSOWInput.date;
    if (updateSOWInput.sowTitle !== undefined) updateData.sowTitle = updateSOWInput.sowTitle;
    if (updateSOWInput.clientName !== undefined) updateData.clientName = updateSOWInput.clientName;
    if (updateSOWInput.clientEmail !== undefined) updateData.clientEmail = updateSOWInput.clientEmail;
    if (updateSOWInput.clientInstitution !== undefined) updateData.clientInstitution = updateSOWInput.clientInstitution;
    if (updateSOWInput.clientAddress !== undefined) updateData.clientAddress = updateSOWInput.clientAddress;
    if (updateSOWInput.scopeOfWork !== undefined) updateData.scopeOfWork = updateSOWInput.scopeOfWork;
    if (updateSOWInput.deliverables !== undefined) updateData.deliverables = updateSOWInput.deliverables;
    if (updateSOWInput.services !== undefined) updateData.services = services;
    if (updateSOWInput.timeline !== undefined) updateData.timeline = updateSOWInput.timeline;
    if (updateSOWInput.resources !== undefined) updateData.resources = updateSOWInput.resources;
    if (updateSOWInput.pricing !== undefined) {
      updateData.pricing = {
        baseCost: updateSOWInput.pricing.baseCost ?? sow.pricing.baseCost,
        adjustments,
        totalCost: updateSOWInput.pricing.totalCost ?? sow.pricing.totalCost,
        discount: updateSOWInput.pricing.discount ?? sow.pricing.discount
      };
    }
    if (updateSOWInput.terms !== undefined) updateData.terms = updateSOWInput.terms;
    if (updateSOWInput.additionalInformation !== undefined) updateData.additionalInformation = updateSOWInput.additionalInformation;
    if (updateSOWInput.status !== undefined) updateData.status = updateSOWInput.status;

    const updatedSOW = await this.sowModel.findByIdAndUpdate(id, { $set: updateData }, { new: true }).exec();
    if (!updatedSOW) {
      throw new NotFoundException(`SOW with ID ${id} not found`);
    }

    return updatedSOW;
  }

  /**
   * Delete a SOW
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.sowModel.findByIdAndDelete(id).exec();
    return !!result;
  }

  /**
   * Find SOW by ID
   */
  async findById(id: string): Promise<SOW | null> {
    return this.sowModel.findById(id).exec();
  }

  /**
   * Find SOW by job ID
   */
  async findByJobId(jobId: string): Promise<SOW | null> {
    return this.sowModel.findOne({ jobId }).exec();
  }

  /**
   * Find SOWs by status
   */
  async findByStatus(status: SOWStatus): Promise<SOW[]> {
    return this.sowModel.find({ status }).sort({ createdAt: -1 }).exec();
  }

  /**
   * Find all SOWs
   */
  async findAll(): Promise<SOW[]> {
    return this.sowModel.find({}).sort({ createdAt: -1 }).exec();
  }

  /** Max size for signatureDataUrl in bytes (500 KB). Base64 increases size ~4/3, so we limit string length. */
  private static readonly SIGNATURE_DATA_URL_MAX_BYTES = 500 * 1024;

  /**
   * Submit a signature for an SOW (client or technician). Idempotent per role.
   * CLIENT: only the job owner (matching email or sub) can submit.
   * TECHNICIAN: only users with DamplabStaff role can submit.
   */
  async submitSignature(input: SubmitSOWSignatureInput, user: User): Promise<SOW> {
    const sow = await this.sowModel.findById(input.sowId).exec();
    if (!sow) {
      throw new NotFoundException(`SOW with ID ${input.sowId} not found`);
    }

    const job = await this.jobService.findById(sow.jobId);
    if (!job) {
      throw new BadRequestException('SOW job not found');
    }

    if (input.role === SOWSignatureRole.CLIENT) {
      const isOwner = job.email === user.email || job.sub === user.sub;
      if (!isOwner) {
        throw new BadRequestException('Only the job owner (client) can submit the client signature');
      }
    } else if (input.role === SOWSignatureRole.TECHNICIAN) {
      const roles = user.realm_access?.roles ?? [];
      const isStaff = roles.includes(Role.DamplabStaff);
      if (!isStaff) {
        throw new BadRequestException('Only staff can submit the technician signature');
      }
    }

    if (!input.name?.trim()) {
      throw new BadRequestException('Signature name is required');
    }

    const signedAtDate = new Date(input.signedAt);
    if (isNaN(signedAtDate.getTime())) {
      throw new BadRequestException('signedAt must be a valid ISO 8601 date-time');
    }

    if (input.signatureDataUrl) {
      const sizeBytes = Buffer.byteLength(input.signatureDataUrl, 'utf8');
      if (sizeBytes > SOWService.SIGNATURE_DATA_URL_MAX_BYTES) {
        throw new BadRequestException(
          `signatureDataUrl must be at most ${SOWService.SIGNATURE_DATA_URL_MAX_BYTES / 1024} KB`
        );
      }
    }

    const signature: SOWSignature = {
      name: input.name.trim(),
      title: input.title?.trim(),
      signedAt: input.signedAt,
      signatureDataUrl: input.signatureDataUrl || undefined
    };

    const updateKey = input.role === SOWSignatureRole.CLIENT ? 'clientSignature' : 'technicianSignature';
    const updateData: any = {
      [updateKey]: signature,
      updatedAt: new Date()
    };

    const updated = await this.sowModel.findByIdAndUpdate(input.sowId, { $set: updateData }, { new: true }).exec();
    if (!updated) {
      throw new NotFoundException(`SOW with ID ${input.sowId} not found`);
    }

    const hasClient = !!updated.clientSignature;
    const hasTechnician = !!updated.technicianSignature;
    if (hasClient && hasTechnician && updated.status !== SOWStatus.SIGNED) {
      await this.sowModel.findByIdAndUpdate(input.sowId, { $set: { status: SOWStatus.SIGNED, updatedAt: new Date() } });
      const final = await this.sowModel.findById(input.sowId).exec();
      return final!;
    }

    return updated;
  }

  /**
   * Upsert SOW for a job (create or update if exists)
   */
  async upsertForJob(jobId: string, createSOWInput: CreateSOWInput): Promise<SOW> {
    const existingSOW = await this.findByJobId(jobId);

    if (existingSOW) {
      // Update existing SOW
      const updateInput: UpdateSOWInput = {
        sowNumber: createSOWInput.sowNumber,
        date: createSOWInput.date,
        sowTitle: createSOWInput.sowTitle,
        clientName: createSOWInput.clientName,
        clientEmail: createSOWInput.clientEmail,
        clientInstitution: createSOWInput.clientInstitution,
        clientAddress: createSOWInput.clientAddress,
        scopeOfWork: createSOWInput.scopeOfWork,
        deliverables: createSOWInput.deliverables,
        services: createSOWInput.services,
        timeline: createSOWInput.timeline,
        resources: createSOWInput.resources,
        pricing: createSOWInput.pricing,
        terms: createSOWInput.terms,
        additionalInformation: createSOWInput.additionalInformation,
        status: createSOWInput.status
      };
      return this.update(existingSOW._id, updateInput);
    } else {
      // Create new SOW
      return this.create(createSOWInput);
    }
  }
}
