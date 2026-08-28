import { registerEnumType } from '@nestjs/graphql';
import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';

/**
 * The four columns of `docs/access-matrix.md`, as an audience a piece of content can
 * be addressed to. Shared by announcements and Learning Hub resources.
 *
 * Deliberately its own vocabulary rather than reusing `Role` or `Permission`.
 * "Who should see this" is a targeting question, not an authorization one — a
 * tech-only lab-inspection notice is not about what technicians may *do* — and tying
 * the picker to the permission enum would mean every new permission turned up as an
 * audience checkbox.
 *
 * **The enum keeps the GraphQL name `AnnouncementAudience`** even though it now
 * serves both features. Renaming it would churn the schema and the frontend's
 * generated types for no behavioural gain; the historical name is a smaller cost
 * than a breaking rename.
 *
 * One distinction worth holding onto, because the mechanism is identical and the
 * stakes are not: for an announcement this is **editorial** targeting — the worst
 * case is someone reads a notice meant for another group. For a training resource it
 * is **authorization** — the audience decides who may download a file. Both filter
 * server-side, and the training path re-checks on download rather than trusting that
 * the list query already filtered.
 */
export enum AnnouncementAudience {
  ADMINISTRATOR = 'ADMINISTRATOR',
  TECHNICIAN = 'TECHNICIAN',
  EQUIPMENT_USER = 'EQUIPMENT_USER',
  /** The floor. Every authenticated user is in this audience. */
  CLIENT = 'CLIENT'
}
registerEnumType(AnnouncementAudience, { name: 'AnnouncementAudience' });

/**
 * The audiences a caller belongs to.
 *
 * Always includes CLIENT, because the client tier is the baseline floor rather than
 * a grant — the same reasoning as `BASELINE_PERMISSIONS`. So an announcement
 * addressed to clients reaches everyone, which is what "everyone" means here.
 */
/**
 * Note what this deliberately does *not* do: an administrator is not added to every
 * audience. Posting a technician-only notice and then not seeing it in your own
 * feed is the literal reading of "technicians only", and the editor
 * (`allAnnouncements`) is where an admin reviews everything regardless of audience.
 */
export function audiencesFor(user: User | undefined | null): AnnouncementAudience[] {
  const roles = user?.realm_access?.roles ?? [];
  const audiences = new Set<AnnouncementAudience>([AnnouncementAudience.CLIENT]);
  if (roles.includes(Role.DamplabStaff)) audiences.add(AnnouncementAudience.ADMINISTRATOR);
  if (roles.includes(Role.Technician)) audiences.add(AnnouncementAudience.TECHNICIAN);
  if (roles.includes(Role.ClientUnassistedEquipmentUser)) audiences.add(AnnouncementAudience.EQUIPMENT_USER);
  return [...audiences];
}
