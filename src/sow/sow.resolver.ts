import { Resolver, Query, Mutation, Args, ID, ResolveField, Parent } from '@nestjs/graphql';
import { SOW, SOWStatus } from './sow.model';
import { SOWService } from './sow.service';
import { CreateSOWInput } from './dto/create-sow.input';
import { UpdateSOWInput } from './dto/update-sow.input';
import { SubmitSOWSignatureInput } from './dto/submit-sow-signature.input';
import { Job } from '../job/job.model';
import { JobService } from '../job/job.service';
import { UseGuards } from '@nestjs/common';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

@Resolver(() => SOW)
export class SOWResolver {
  constructor(private readonly sowService: SOWService, private readonly jobService: JobService) {}

  @Query(() => SOW, { nullable: true, description: 'Get SOW by ID' })
  async sowById(@Args('id', { type: () => ID }) id: string): Promise<SOW | null> {
    return this.sowService.findById(id);
  }

  @Query(() => SOW, { nullable: true, description: 'Get SOW by job ID' })
  async sowByJobId(@Args('jobId', { type: () => ID }) jobId: string): Promise<SOW | null> {
    return this.sowService.findByJobId(jobId);
  }

  @Query(() => [SOW], { description: 'Get all SOWs by status' })
  async sowsByStatus(@Args('status', { type: () => SOWStatus }) status: SOWStatus): Promise<SOW[]> {
    return this.sowService.findByStatus(status);
  }

  @Query(() => [SOW], { description: 'Get all SOWs' })
  async allSOWs(): Promise<SOW[]> {
    return this.sowService.findAll();
  }

  @Mutation(() => SOW, { description: 'Create a new SOW' })
  @UseGuards(AuthRolesGuard)
  async createSOW(@Args('input', { type: () => CreateSOWInput }) input: CreateSOWInput, @CurrentUser() user: User): Promise<SOW> {
    // Use user email or preferred_username as createdBy if not provided
    const createdBy = input.createdBy || user.email || user.preferred_username || 'unknown';
    return this.sowService.create({ ...input, createdBy });
  }

  @Mutation(() => SOW, { description: 'Update an existing SOW' })
  @UseGuards(AuthRolesGuard)
  async updateSOW(@Args('id', { type: () => ID }) id: string, @Args('input', { type: () => UpdateSOWInput }) input: UpdateSOWInput): Promise<SOW> {
    return this.sowService.update(id, input);
  }

  @Mutation(() => Boolean, { description: 'Delete a SOW' })
  @UseGuards(AuthRolesGuard)
  async deleteSOW(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.sowService.delete(id);
  }

  @Mutation(() => SOW, { description: 'Create or update SOW for a job (upsert)' })
  @UseGuards(AuthRolesGuard)
  async upsertSOWForJob(@Args('jobId', { type: () => ID }) jobId: string, @Args('input', { type: () => CreateSOWInput }) input: CreateSOWInput, @CurrentUser() user: User): Promise<SOW> {
    // Use user email or preferred_username as createdBy if not provided
    const createdBy = input.createdBy || user.email || user.preferred_username || 'unknown';
    return this.sowService.upsertForJob(jobId, { ...input, jobId, createdBy });
  }

  @Mutation(() => SOW, {
    description: 'Submit a signature for an SOW (client or technician). Idempotent per role.'
  })
  @UseGuards(AuthRolesGuard)
  async submitSOWSignature(
    @Args('input', { type: () => SubmitSOWSignatureInput }) input: SubmitSOWSignatureInput,
    @CurrentUser() user: User
  ): Promise<SOW> {
    return this.sowService.submitSignature(input, user);
  }

  @ResolveField(() => Job, { description: 'Job this SOW is associated with' })
  async job(@Parent() sow: SOW): Promise<Job | null> {
    return this.jobService.findById(sow.jobId);
  }
}
