import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';
import { AnnouncementAudience, audiencesFor } from './announcement-audience';

const userWith = (roles: string[]): User => ({ preferred_username: 'u', sub: 's', email: 'e', realm_access: { roles } } as User);

describe('audiencesFor — who an announcement reaches', () => {
  it('always includes CLIENT, because the client tier is the floor and not a grant', () => {
    for (const roles of [[], [Role.DamplabStaff], [Role.Technician], [Role.ClientUnassistedEquipmentUser]]) {
      expect(audiencesFor(userWith(roles))).toContain(AnnouncementAudience.CLIENT);
    }
  });

  it('gives a user with no roles exactly the client audience', () => {
    expect(audiencesFor(userWith([]))).toEqual([AnnouncementAudience.CLIENT]);
  });

  it('maps each access role to its matrix column', () => {
    expect(audiencesFor(userWith([Role.DamplabStaff])).sort()).toEqual([AnnouncementAudience.ADMINISTRATOR, AnnouncementAudience.CLIENT].sort());
    expect(audiencesFor(userWith([Role.Technician])).sort()).toEqual([AnnouncementAudience.CLIENT, AnnouncementAudience.TECHNICIAN].sort());
    expect(audiencesFor(userWith([Role.ClientUnassistedEquipmentUser])).sort()).toEqual([AnnouncementAudience.CLIENT, AnnouncementAudience.EQUIPMENT_USER].sort());
  });

  it('unions across roles, like permissions do', () => {
    const both = audiencesFor(userWith([Role.DamplabStaff, Role.Technician]));
    expect(both).toContain(AnnouncementAudience.ADMINISTRATOR);
    expect(both).toContain(AnnouncementAudience.TECHNICIAN);
  });

  it('does not give a client the technician audience — the case the feature exists for', () => {
    // A tech-only "lab inspection" notice must not reach a customer.
    expect(audiencesFor(userWith([]))).not.toContain(AnnouncementAudience.TECHNICIAN);
    expect(audiencesFor(userWith([Role.ExternalCustomer]))).not.toContain(AnnouncementAudience.TECHNICIAN);
  });

  it('handles a missing user rather than throwing', () => {
    expect(audiencesFor(undefined)).toEqual([AnnouncementAudience.CLIENT]);
  });
});
