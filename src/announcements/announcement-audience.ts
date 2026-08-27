import { registerEnumType } from '@nestjs/graphql';
import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';

/**
 * The four columns of `docs/access-matrix.md`, as an audience an announcement can
 * be addressed to.
 *
 * Deliberately its own vocabulary rather than reusing `Role` or `Permission`.
 * "Who should read this notice" is an editorial question, not an authorization
 * one — a tech-only lab-inspection notice is not about what technicians may *do* —
 * and tying the picker to the permission enum would mean every new permission
 * turned up as an audience checkbox.
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
