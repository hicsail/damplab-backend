import { Resolver, Query, Mutation, Args, ID, Int, ResolveField, Parent } from '@nestjs/graphql';
import { SOW, SOWStatus } from './sow.model';
import { SOWService } from './sow.service';
import { SowVersionService } from './sow-version.service';
import { SowVersion, SowCalculatedValue } from './sow-version.model';
import { CreateSOWInput } from './dto/create-sow.input';
import { UpdateSOWInput } from './dto/update-sow.input';
import { SubmitSOWSignatureInput } from './dto/submit-sow-signature.input';
import { SaveSowVersionInput } from './dto/save-sow-version.input';
import { SignSowInput } from './dto/sign-sow.input';
import { SowInputsInput } from './dto/sow-inputs.input';
import { Job } from '../job/job.model';
import { JobService } from '../job/job.service';
import { UseGuards, NotFoundException } from '@nestjs/common';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';
import { assertCanReadSow, assertJobOwner, canSeeAllVersions, isStaff } from './sow-access';

@Resolver(() => SOW)
@UseGuards(AuthRolesGuard)
export class SOWResolver {
  constructor(private readonly sowService: SOWService, private readonly jobService: JobService, private readonly sowVersionService: SowVersionService) {}

  /**
   * Loads a SOW and checks the caller may see it. Every version query and
   * mutation goes through here, so access is decided in one place rather than
   * repeated per resolver.
   */
  private async authorizedSow(sowId: string, user: User): Promise<SOW> {
    const sow = await this.sowService.findById(sowId);
    if (!sow) throw new NotFoundException(`SOW with ID ${sowId} not found`);
    assertCanReadSow(await this.jobService.findById(sow.jobId), user);
    return sow;
  }

  private static author(user: User): { sub: string; name: string } {
    return { sub: user.sub, name: user.preferred_username || user.email || user.sub };
  }

  @Query(() => SOW, { nullable: true, description: 'Get SOW by ID. Staff can view any; clients can view their own.' })
  async sowById(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: User): Promise<SOW | null> {
    const sow = await this.sowService.findById(id);
    if (!sow) return null;
    assertCanReadSow(await this.jobService.findById(sow.jobId), user);
    return sow;
  }

  @Query(() => SOW, { nullable: true, description: 'Get SOW by job ID. Staff can view any; clients can view their own.' })
  async sowByJobId(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<SOW | null> {
    const sow = await this.sowService.findByJobId(jobId);
    if (!sow) return null;
    assertCanReadSow(await this.jobService.findById(jobId), user);
    return sow;
  }

  @Query(() => [SOW], { description: 'Staff-only. Get all SOWs by status.' })
  @Roles(Role.DamplabStaff)
  async sowsByStatus(@Args('status', { type: () => SOWStatus }) status: SOWStatus): Promise<SOW[]> {
    return this.sowService.findByStatus(status);
  }

  @Query(() => [SOW], { description: 'Staff-only. Get all SOWs.' })
  @Roles(Role.DamplabStaff)
  async allSOWs(): Promise<SOW[]> {
    return this.sowService.findAll();
  }

  @Mutation(() => SOW, { description: 'Staff-only. Create a new SOW.' })
  @Roles(Role.DamplabStaff)
  async createSOW(@Args('input', { type: () => CreateSOWInput }) input: CreateSOWInput, @CurrentUser() user: User): Promise<SOW> {
    // Use user email or preferred_username as createdBy if not provided
    const createdBy = input.createdBy || user.email || user.preferred_username || 'unknown';
    return this.sowService.create({ ...input, createdBy });
  }

  @Mutation(() => SOW, { description: 'Staff-only. Update an existing SOW.' })
  @Roles(Role.DamplabStaff)
  async updateSOW(@Args('id', { type: () => ID }) id: string, @Args('input', { type: () => UpdateSOWInput }) input: UpdateSOWInput): Promise<SOW> {
    return this.sowService.update(id, input);
  }

  @Mutation(() => Boolean, { description: 'Staff-only. Delete a SOW.' })
  @Roles(Role.DamplabStaff)
  async deleteSOW(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.sowService.delete(id);
  }

  @Mutation(() => SOW, { description: 'Staff-only. Create or update SOW for a job (upsert).' })
  @Roles(Role.DamplabStaff)
  async upsertSOWForJob(@Args('jobId', { type: () => ID }) jobId: string, @Args('input', { type: () => CreateSOWInput }) input: CreateSOWInput, @CurrentUser() user: User): Promise<SOW> {
    // Use user email or preferred_username as createdBy if not provided
    const createdBy = input.createdBy || user.email || user.preferred_username || 'unknown';
    return this.sowService.upsertForJob(jobId, { ...input, jobId, createdBy });
  }

  @Mutation(() => SOW, {
    description: 'Submit a signature for an SOW (client or technician). Idempotent per role; the service checks job ownership for CLIENT and staff role for TECHNICIAN.'
  })
  async submitSOWSignature(@Args('input', { type: () => SubmitSOWSignatureInput }) input: SubmitSOWSignatureInput, @CurrentUser() user: User): Promise<SOW> {
    return this.sowService.submitSignature(input, user);
  }

  @ResolveField(() => Job, { description: 'Job this SOW is associated with' })
  async job(@Parent() sow: SOW): Promise<Job | null> {
    return this.jobService.findById(sow.jobId);
  }

  // ---------------------------------------------------------------------------
  // Versioned document
  // ---------------------------------------------------------------------------

  @ResolveField(() => SowVersion, { nullable: true, description: 'Latest version — what staff edit. May be an unsent draft.' })
  async currentVersion(@Parent() sow: SOW, @CurrentUser() user: User): Promise<SowVersion | null> {
    // Customers must not see drafts, so they get the version in force instead.
    if (!isStaff(user)) return this.sowVersionService.getActiveVersion(String((sow as any)._id));
    return this.sowVersionService.getCurrentVersion(String((sow as any)._id));
  }

  @ResolveField(() => SowVersion, { nullable: true, description: 'Version currently in force with the customer' })
  async activeVersion(@Parent() sow: SOW): Promise<SowVersion | null> {
    return this.sowVersionService.getActiveVersion(String((sow as any)._id));
  }

  @ResolveField(() => [SowVersion], { description: 'Version history, newest first. Staff see every version; customers see only those issued to them.' })
  async versions(@Parent() sow: SOW, @CurrentUser() user: User): Promise<SowVersion[]> {
    return this.sowVersionService.listVersions(String((sow as any)._id), { visibleOnly: !canSeeAllVersions(user) });
  }

  @Query(() => [SowVersion], { description: 'Version history for a SOW, newest first. Staff see every version; customers see only those issued to them.' })
  async sowVersions(@Args('sowId', { type: () => ID }) sowId: string, @CurrentUser() user: User): Promise<SowVersion[]> {
    await this.authorizedSow(sowId, user);
    return this.sowVersionService.listVersions(sowId, { visibleOnly: !canSeeAllVersions(user) });
  }

  @Query(() => SowVersion, { nullable: true, description: 'One version of a SOW. Customers may only read versions issued to them.' })
  async sowVersion(@Args('sowId', { type: () => ID }) sowId: string, @Args('versionNumber', { type: () => Int }) versionNumber: number, @CurrentUser() user: User): Promise<SowVersion | null> {
    await this.authorizedSow(sowId, user);
    const version = await this.sowVersionService.getVersion(sowId, versionNumber);
    if (!version) return null;
    if (!canSeeAllVersions(user) && !version.visibleToCustomer) return null;
    return version;
  }

  @Query(() => [SowCalculatedValue], {
    description: 'Staff-only. Recomputes the generated text for the given inputs without saving. Returns generated values only — the editor keeps its own overrides and enable flags.'
  })
  @Roles(Role.DamplabStaff)
  async sowFieldPreview(@Args('sowId', { type: () => ID }) sowId: string, @Args('inputs', { type: () => SowInputsInput }) inputs: SowInputsInput): Promise<SowCalculatedValue[]> {
    return this.sowVersionService.previewCalculatedValues(sowId, inputs);
  }

  @Mutation(() => SowVersion, { description: 'Staff-only. Saves edits as a new draft. Does not change what the customer sees.' })
  @Roles(Role.DamplabStaff)
  async saveSowVersion(
    @Args('sowId', { type: () => ID }) sowId: string,
    @Args('input', { type: () => SaveSowVersionInput }) input: SaveSowVersionInput,
    @CurrentUser() user: User
  ): Promise<SowVersion> {
    await this.authorizedSow(sowId, user);
    return this.sowVersionService.saveVersion(sowId, input, SOWResolver.author(user));
  }

  @Mutation(() => SOW, { description: 'Staff-only. Discards an unsent draft above the active version.' })
  @Roles(Role.DamplabStaff)
  async discardSowDraft(@Args('sowId', { type: () => ID }) sowId: string, @Args('versionNumber', { type: () => Int }) versionNumber: number, @CurrentUser() user: User): Promise<SOW> {
    await this.authorizedSow(sowId, user);
    return this.sowVersionService.discardDraft(sowId, versionNumber);
  }

  @Mutation(() => SowVersion, { description: 'Staff-only. Issues the current draft to the customer for signing.' })
  @Roles(Role.DamplabStaff)
  async sendSowToCustomer(@Args('sowId', { type: () => ID }) sowId: string, @CurrentUser() user: User): Promise<SowVersion> {
    await this.authorizedSow(sowId, user);
    return this.sowVersionService.sendToCustomer(sowId, SOWResolver.author(user));
  }

  @Mutation(() => SowVersion, { description: 'Job owner only. Records the customer signature on the version in force.' })
  async signSow(@Args('sowId', { type: () => ID }) sowId: string, @Args('input', { type: () => SignSowInput }) input: SignSowInput, @CurrentUser() user: User): Promise<SowVersion> {
    const sow = await this.authorizedSow(sowId, user);
    // Signing records the customer's own assent, so staff cannot stand in for them.
    assertJobOwner(await this.jobService.findById(sow.jobId), user);
    return this.sowVersionService.sign(sowId, input, user);
  }

  @Mutation(() => SowVersion, { description: 'Staff-only. Countersigns a signed SOW and locks it as FINAL.' })
  @Roles(Role.DamplabStaff)
  async finalizeSow(@Args('sowId', { type: () => ID }) sowId: string, @Args('name') name: string, @CurrentUser() user: User): Promise<SowVersion> {
    await this.authorizedSow(sowId, user);
    return this.sowVersionService.finalize(sowId, name, SOWResolver.author(user));
  }

  @Mutation(() => SowVersion, { description: 'Staff-only. Cancels the SOW.' })
  @Roles(Role.DamplabStaff)
  async cancelSow(
    @Args('sowId', { type: () => ID }) sowId: string,
    // Explicit type: an optional parameter erases to `undefined` at runtime, so
    // the schema builder cannot infer String on its own.
    @Args('note', { type: () => String, nullable: true }) note: string | undefined,
    @CurrentUser() user: User
  ): Promise<SowVersion> {
    await this.authorizedSow(sowId, user);
    return this.sowVersionService.cancel(sowId, note, SOWResolver.author(user));
  }
}
