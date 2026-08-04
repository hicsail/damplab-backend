import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * Mirrors BugSeverity so the app can colour cards consistently. ClickUp itself
 * stores this as built-in task PRIORITY (urgent/high/normal/low), because the
 * ClickUp API cannot create custom fields — only read and set existing ones.
 */
export enum BacklogSeverity {
  BLOCKER = 'BLOCKER',
  MAJOR = 'MAJOR',
  MINOR = 'MINOR',
  COSMETIC = 'COSMETIC',
  UNKNOWN = 'UNKNOWN'
}
registerEnumType(BacklogSeverity, { name: 'BacklogSeverity' });

@ObjectType({ description: 'A comment on a backlog card.' })
export class BacklogComment {
  @Field(() => ID) id: string;

  @Field({ description: 'Display name of whoever wrote it. For comments posted from the app this is the app user, parsed from the attribution prefix; otherwise the ClickUp author.' })
  author: string;

  @Field(() => Boolean, { description: 'True when the comment originated in the app rather than being written directly in ClickUp.' })
  fromApp: boolean;

  @Field({ description: 'Comment body, with any attribution prefix stripped.' })
  text: string;

  @Field({ description: 'ISO timestamp.' })
  createdAt: string;
}

@ObjectType({ description: 'A bug backlog card, sourced from ClickUp and filed by the n8n triage workflow.' })
export class BacklogCard {
  @Field(() => ID, { description: 'ClickUp task id.' }) id: string;

  @Field() title: string;

  @Field({ description: 'ClickUp status name (Open, in progress, review, blocked, on hold, Closed).' })
  status: string;

  @Field(() => Boolean, { description: 'True when the card sits in a closed-type status.' })
  isClosed: boolean;

  @Field(() => BacklogSeverity, { description: 'Derived from the ClickUp task priority.' })
  severity: BacklogSeverity;

  @Field({ nullable: true, description: 'Feature area the bug was reported against.' })
  area?: string;

  @Field({ nullable: true, description: 'AI-assigned category (ui, backend, data, auth, perf, …).' })
  category?: string;

  @Field({ nullable: true, description: 'One-line summary written by triage.' })
  summary?: string;

  @Field({ nullable: true, description: 'Steps to reproduce, as reported.' })
  stepsToReproduce?: string;

  @Field({ nullable: true }) expected?: string;
  @Field({ nullable: true }) actual?: string;

  @Field({ nullable: true, description: 'Proposed fix or action item from triage.' })
  proposedFix?: string;

  @Field(() => [String], { description: 'Names of anyone assigned in ClickUp. Assignment is done by hand during triage — the pipeline never guesses an owner.' })
  assignees: string[];

  @Field({ nullable: true, description: 'Reporter display name. Null for non-staff viewers.' })
  reporterName?: string;

  @Field({ nullable: true, description: 'Reporter email. STAFF ONLY — always null for non-staff viewers.' })
  reporterEmail?: string;

  @Field({ nullable: true, description: 'Session/campaign tag, e.g. "testathon".' })
  sessionTag?: string;

  @Field(() => Int, { description: 'How many times this bug has been reported (deduped by triage).' })
  occurrences: number;

  @Field({ nullable: true, description: 'The originating BugReport id in our own DB.' })
  sourceBugId?: string;

  @Field(() => Int, { description: 'Number of comments on the card.' })
  commentCount: number;

  @Field({ nullable: true, description: 'Direct ClickUp link. STAFF ONLY — null for non-staff, who have no ClickUp access.' })
  clickupUrl?: string;

  @Field({ description: 'ISO timestamp.' }) createdAt: string;
  @Field({ nullable: true, description: 'ISO timestamp.' }) updatedAt?: string;
}

@ObjectType({ description: 'A backlog card together with its comment thread.' })
export class BacklogCardDetail {
  @Field(() => BacklogCard) card: BacklogCard;
  @Field(() => [BacklogComment]) comments: BacklogComment[];
}
