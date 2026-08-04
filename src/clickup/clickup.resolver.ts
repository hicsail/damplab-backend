import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ClickUpService } from './clickup.service';
import { BacklogCard, BacklogCardDetail, BacklogComment } from './clickup.dto';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { Role } from '../auth/roles/roles.enum';

/**
 * The bug backlog, readable by ANY authenticated user — testathon participants
 * and customers follow up on bugs they filed, so this deliberately carries no
 * @Roles restriction (the guard still requires a valid token).
 *
 * Non-staff viewers get a redacted card: reporter email is stripped, as is the
 * ClickUp deep link (they have no ClickUp account, so it would only 404 for them).
 */
@Resolver(() => BacklogCard)
@UseGuards(AuthRolesGuard)
export class ClickUpResolver {
  constructor(private readonly clickup: ClickUpService) {}

  private isStaff(user: User): boolean {
    return (user?.realm_access?.roles ?? []).includes(Role.DamplabStaff);
  }

  /** Strip anything a non-staff viewer shouldn't see. */
  private redact(card: BacklogCard, staff: boolean): BacklogCard {
    if (staff) return card;
    return { ...card, reporterEmail: undefined, clickupUrl: undefined };
  }

  @Query(() => [BacklogCard], { description: 'The bug backlog. Any authenticated user; non-staff see a redacted view.' })
  async backlogCards(@CurrentUser() user: User): Promise<BacklogCard[]> {
    const staff = this.isStaff(user);
    const cards = await this.clickup.listBacklog();
    return cards.map((c) => this.redact(c, staff));
  }

  @Query(() => BacklogCardDetail, { description: 'One backlog card with its comment thread.' })
  async backlogCard(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: User): Promise<BacklogCardDetail> {
    const staff = this.isStaff(user);
    const [card, comments] = await Promise.all([this.clickup.getCard(id), this.clickup.getComments(id)]);
    return { card: this.redact(card, staff), comments };
  }

  @Query(() => Boolean, { description: 'Whether the backlog integration is configured, so the UI can show a helpful empty state instead of an error.' })
  async backlogAvailable(): Promise<boolean> {
    return this.clickup.isConfigured();
  }

  @Mutation(() => BacklogComment, { description: 'Add a comment to a backlog card, attributed to the signed-in user.' })
  async addBacklogComment(
    @Args('cardId', { type: () => ID }) cardId: string,
    @Args('body') body: string,
    @CurrentUser() user: User
  ): Promise<BacklogComment> {
    // Attribution comes from the verified token, never from client input —
    // otherwise anyone could post as anyone else. Prefer the `name` claim so the
    // thread reads with real names, matching how bug reports capture reporters.
    const author = (user as any)?.name || user?.preferred_username || user?.email || 'Unknown user';
    return this.clickup.addComment(cardId, body, author);
  }
}
