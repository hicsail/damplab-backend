import { jobVersionAuthorOrg } from './author-org';
import { JobVersionAuthorRole } from './job-version.model';

/**
 * The org an edit is stamped with, decided at write time.
 *
 * Deliberately not derived when the history is *read*: that would report the
 * editor's tier as it stands today rather than the one they held when they made
 * the edit, and would cost a Keycloak call per row of a list.
 */
describe('jobVersionAuthorOrg', () => {
  const staff = (roles: string[]): string => jobVersionAuthorOrg({ authorRole: JobVersionAuthorRole.STAFF, claims: roles, institute: 'BU' });

  it('labels a staff author by the access tier their token grants', () => {
    expect(staff(['damplab-staff'])).toBe('Administrator');
    expect(staff(['technician'])).toBe('Technician');
  });

  it('reports the highest tier when a staff author holds several roles', () => {
    // Permissions union across roles, so describing them as the lesser tier
    // would understate what the edit was made with.
    expect(staff(['technician', 'damplab-staff'])).toBe('Administrator');
  });

  it('stamps a customer author with the job institute, not a tier', () => {
    expect(jobVersionAuthorOrg({ authorRole: JobVersionAuthorRole.CUSTOMER, claims: ['damplab-staff'], institute: 'Boston University' })).toBe('Boston University');
  });

  it('returns empty rather than a placeholder when there is nothing to say', () => {
    // The history subtitle filters empties out, so a blank degrades to the name
    // and role alone — which is what every legacy row will show.
    expect(jobVersionAuthorOrg({ authorRole: JobVersionAuthorRole.CUSTOMER, claims: [], institute: undefined })).toBe('');
    expect(jobVersionAuthorOrg({ authorRole: JobVersionAuthorRole.CUSTOMER, claims: [], institute: '   ' })).toBe('');
    expect(jobVersionAuthorOrg({ authorRole: JobVersionAuthorRole.STAFF, claims: [] })).toBe('');
  });

  it('accepts group names as well as realm roles', () => {
    // deriveAccessTier matches either spelling, so a caller holding an Admin API
    // group list gets the same answer as one holding a token.
    expect(staff(['/damplab-staff'])).toBe('Administrator');
  });
});
