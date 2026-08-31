import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerCategory } from '../job/job.model';
import {
  CATEGORY_PRIMARY_GROUP,
  claimsFromGroupList,
  deriveCustomerCategoryFromGroups as deriveCategoryFromGroups,
  isCustomerPricingGroupName,
  isDefaultExternalCustomerClaims
} from '../pricing/pricing-groups';
import { AccessTier, TIER_GROUP, TIER_ROLE, deriveAccessTierFromGroups, isAccessGroupName } from '../auth/roles/access-tiers';

export interface LabStaffMember {
  id: string;
  displayName: string;
  email?: string;
}

export interface KeycloakUserCustomerManagementRow {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  customerCategory?: CustomerCategory;
  isDefaultExternalCustomer?: boolean;
  /** The access column this user resolves to. Independent of `customerCategory`. */
  accessTier?: AccessTier;
}

interface KeycloakGroup {
  id: string;
  name: string;
  path?: string;
  subGroups?: KeycloakGroup[];
}

interface KeycloakUser {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

@Injectable()
export class KeycloakService {
  private readonly logger = new Logger(KeycloakService.name);
  private readonly serverUrl: string | undefined;
  private readonly realm: string;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly labStaffGroupNames: readonly string[];
  /**
   * True when `DISABLE_AUTH` is on. Group writes are refused in that state — see
   * `assertGroupWritesAllowed`.
   */
  private readonly authDisabled: boolean;

  constructor(private readonly configService: ConfigService) {
    const kc = this.configService.get<{ serverUrl?: string; realm?: string; clientId?: string; clientSecret?: string; labStaffGroupNames?: string[] }>('keycloak');
    this.serverUrl = kc?.serverUrl;
    this.realm = kc?.realm ?? 'damplab';
    this.clientId = kc?.clientId;
    this.clientSecret = kc?.clientSecret;
    this.labStaffGroupNames = kc?.labStaffGroupNames?.length ? kc.labStaffGroupNames : ['damplab-staff'];
    this.authDisabled = Boolean(this.configService.get('auth.disable'));
  }

  /**
   * Refuse to write group membership while the auth bypass is on.
   *
   * The realm is shared by staging and production (see `damplab-ui/CLAUDE.md`), and a
   * developer's `.env` points at it with a live service-account secret. With
   * `DISABLE_AUTH=true` the guard synthesises an administrator for **unauthenticated**
   * requests, so without this check a stray localhost call would silently move a real
   * person between groups in the realm production reads.
   *
   * Reads are left alone deliberately: browsing the user list locally is useful and
   * harmless. Only mutation is blocked, and only in a state production never enters.
   */
  private assertGroupWritesAllowed(): void {
    if (this.authDisabled) {
      throw new Error(
        'Refusing to write Keycloak group membership while DISABLE_AUTH=true. The dev bypass treats unauthenticated callers as administrators, and this realm is shared with production. Unset DISABLE_AUTH and sign in as a real administrator to change a user\u2019s groups.'
      );
    }
  }

  /** True if Keycloak Admin is configured (server URL and client credentials). */
  isConfigured(): boolean {
    return Boolean(this.serverUrl && this.clientId && this.clientSecret);
  }

  /**
   * Obtain an access token using client credentials.
   * Tokens are cached until they expire (we do not parse expiry; each call may refresh).
   */
  private async getAccessToken(): Promise<string> {
    if (!this.serverUrl || !this.clientId || !this.clientSecret) {
      throw new Error('Keycloak Admin is not configured (KEYCLOAK_SERVER_URL, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET)');
    }
    const url = `${this.serverUrl}/realms/${this.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Keycloak token request failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error('Keycloak token response missing access_token');
    return data.access_token;
  }

  private async adminFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getAccessToken();
    const base = this.serverUrl!.replace(/\/$/, '');
    const url = path.startsWith('http') ? path : `${base}${path}`;
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }

  private async fetchWithToken(path: string): Promise<Response> {
    return this.adminFetch(path, { method: 'GET' });
  }

  private async getGroupMembers(groupId: string, first: number, max: number): Promise<KeycloakUser[]> {
    const path = `/admin/realms/${this.realm}/groups/${groupId}/members?first=${encodeURIComponent(Math.max(first ?? 0, 0))}&max=${encodeURIComponent(Math.max(max ?? 0, 0))}`;
    const res = await this.fetchWithToken(path);
    if (!res.ok) {
      this.logger.warn(`Keycloak group members request failed: ${res.status} ${await res.text()}`);
      return [];
    }
    return (await res.json()) as KeycloakUser[];
  }

  /**
   * Delegates to the one shared derivation in `pricing/pricing-groups` — the same
   * function `JobResolver.createJob` and `AddNodeInputPipe` use, so precedence
   * cannot drift between the admin view and what a customer is billed.
   */
  deriveCustomerCategoryFromGroups(groups: { name?: string; path?: string }[]): CustomerCategory | undefined {
    return deriveCategoryFromGroups(groups);
  }

  private isCustomerPricingGroupMember(g: { name?: string }): boolean {
    return isCustomerPricingGroupName(g.name);
  }

  /**
   * True when the user's pricing-group membership consists solely of the default
   * external group (`external-customers`, or the legacy singular spelling) and no
   * more specific pricing group like external-customer-market or internal-customers.
   */
  private isDefaultExternalCustomer(groups: { name?: string; path?: string }[]): boolean {
    return isDefaultExternalCustomerClaims(claimsFromGroupList(groups));
  }

  private rowFromUserAndGroups(user: KeycloakUser, groups: KeycloakGroup[]): KeycloakUserCustomerManagementRow {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      customerCategory: this.deriveCustomerCategoryFromGroups(groups),
      isDefaultExternalCustomer: this.isDefaultExternalCustomer(groups),
      accessTier: deriveAccessTierFromGroups(groups)
    };
  }

  async searchUsers(search: string, max: number): Promise<KeycloakUser[]> {
    const path = `/admin/realms/${this.realm}/users?search=${encodeURIComponent(search)}&max=${max}`;
    const res = await this.fetchWithToken(path);
    if (!res.ok) {
      this.logger.warn(`Keycloak user search failed: ${res.status} ${await res.text()}`);
      return [];
    }
    return (await res.json()) as KeycloakUser[];
  }

  async getUserById(userId: string): Promise<KeycloakUser | null> {
    const res = await this.fetchWithToken(`/admin/realms/${this.realm}/users/${userId}`);
    if (!res.ok) return null;
    return (await res.json()) as KeycloakUser;
  }

  async getUserGroups(userId: string): Promise<KeycloakGroup[]> {
    const res = await this.fetchWithToken(`/admin/realms/${this.realm}/users/${userId}/groups`);
    if (!res.ok) {
      this.logger.warn(`Keycloak user groups failed: ${res.status} ${await res.text()}`);
      return [];
    }
    return (await res.json()) as KeycloakGroup[];
  }

  async addUserToGroup(userId: string, groupId: string): Promise<void> {
    const res = await this.adminFetch(`/admin/realms/${this.realm}/users/${userId}/groups/${groupId}`, {
      method: 'PUT'
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Keycloak add user to group failed: ${res.status} ${text}`);
    }
  }

  async removeUserFromGroup(userId: string, groupId: string): Promise<void> {
    const res = await this.adminFetch(`/admin/realms/${this.realm}/users/${userId}/groups/${groupId}`, {
      method: 'DELETE'
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Keycloak remove user from group failed: ${res.status} ${text}`);
    }
  }

  /**
   * Remove membership from all groups that affect customer pricing (does not touch e.g. damplab-staff).
   */
  async removeUserFromAllCustomerPricingGroups(userId: string): Promise<void> {
    const groups = await this.getUserGroups(userId);
    for (const g of groups) {
      if (this.isCustomerPricingGroupMember(g)) {
        await this.removeUserFromGroup(userId, g.id);
      }
    }
  }

  /**
   * Set exactly one pricing category group (or clear all such groups when category is null).
   */
  async setUserCustomerCategory(userId: string, category: CustomerCategory | null): Promise<void> {
    this.assertGroupWritesAllowed();
    await this.removeUserFromAllCustomerPricingGroups(userId);
    if (category == null) return;
    const groupName = CATEGORY_PRIMARY_GROUP[category];
    const group = await this.findGroupByName(groupName);
    if (!group) {
      throw new Error(`Keycloak group "${groupName}" not found in realm ${this.realm}`);
    }
    await this.addUserToGroup(userId, group.id);
  }

  /**
   * Remove membership from every **access** group, leaving pricing groups alone.
   *
   * The mirror of `removeUserFromAllCustomerPricingGroups`, and the two must never
   * overlap: pricing and access are independent axes, so a tier change that cleared a
   * pricing group would silently reprice the customer. `isAccessGroupName` is an
   * allow-list of exactly three names for that reason.
   */
  async removeUserFromAllAccessGroups(userId: string): Promise<void> {
    const groups = await this.getUserGroups(userId);
    for (const g of groups) {
      if (isAccessGroupName(g.name)) {
        await this.removeUserFromGroup(userId, g.id);
      }
    }
  }

  /**
   * Set exactly one access group, or none at all for `CLIENT`.
   *
   * CLIENT is not a group and never has been — it is `BASELINE_PERMISSIONS`, which
   * every authenticated user resolves to regardless of what they carry. So "make this
   * person a Client" is literally "remove their access groups", and the early return
   * below is the whole implementation of it.
   */
  async setUserAccessTier(userId: string, tier: AccessTier): Promise<void> {
    this.assertGroupWritesAllowed();
    await this.removeUserFromAllAccessGroups(userId);
    const groupName = TIER_GROUP[tier];
    if (groupName == null) return;
    const group = await this.findGroupByName(groupName);
    if (!group) {
      throw new Error(`Keycloak group "${groupName}" not found in realm ${this.realm}`);
    }
    await this.addUserToGroup(userId, group.id);
  }

  /**
   * The user's effective realm roles, composites included.
   *
   * Used **only** on the single-user read-back after a tier write, never in a list
   * loop: every admin call re-fetches a service-account token (`adminFetch`), so a
   * 25-row page already costs ~52 requests and adding one per row would make it ~78.
   *
   * The read-back exists because writing a group grants nothing on its own. The guard
   * reads `realm_access.roles`, so if the realm lacks the group's role mapping the PUT
   * succeeds and the user gains no access at all. Reporting that back is the
   * difference between a visible warning and a silent no-op.
   */
  async getUserRealmRoles(userId: string): Promise<string[]> {
    const res = await this.fetchWithToken(`/admin/realms/${this.realm}/users/${userId}/role-mappings/realm/composite`);
    if (!res.ok) {
      this.logger.warn(`Keycloak realm role-mappings request failed: ${res.status} ${await res.text()}`);
      return [];
    }
    const roles = (await res.json()) as { name?: string }[];
    return roles.map((r) => r.name).filter((name): name is string => Boolean(name));
  }

  /**
   * True when the tier's realm role is actually present on the user.
   *
   * CLIENT is vacuously true: it maps to no role, so there is nothing to verify.
   */
  async isAccessRoleMapped(userId: string, tier: AccessTier): Promise<boolean> {
    const expected = TIER_ROLE[tier];
    if (expected == null) return true;
    const roles = await this.getUserRealmRoles(userId);
    return roles.includes(expected);
  }

  async getUserCustomerManagementRow(userId: string): Promise<KeycloakUserCustomerManagementRow | null> {
    const user = await this.getUserById(userId);
    if (!user) return null;
    const groups = await this.getUserGroups(userId);
    return this.rowFromUserAndGroups(user, groups);
  }

  async searchUsersWithCustomerCategory(search: string, max: number): Promise<KeycloakUserCustomerManagementRow[]> {
    const users = await this.searchUsers(search, max);
    const rows: KeycloakUserCustomerManagementRow[] = [];
    for (const u of users) {
      const groups = await this.getUserGroups(u.id);
      rows.push(this.rowFromUserAndGroups(u, groups));
    }
    return rows;
  }

  /**
   * Find the first group in the realm whose name or path matches the given name (case-sensitive).
   * Uses GET /admin/realms/{realm}/groups?search=name to limit results.
   * Keycloak may return root groups only; we also search in subGroups when present.
   */
  private findGroupInList(groups: KeycloakGroup[], groupName: string): KeycloakGroup | null {
    for (const g of groups) {
      if (g.name === groupName || g.path === `/${groupName}` || g.path?.endsWith(`/${groupName}`)) return g;
      if (g.subGroups?.length) {
        const found = this.findGroupInList(g.subGroups, groupName);
        if (found) return found;
      }
    }
    return null;
  }

  private async findGroupByName(groupName: string): Promise<KeycloakGroup | null> {
    const path = `/admin/realms/${this.realm}/groups?search=${encodeURIComponent(groupName)}`;
    const res = await this.fetchWithToken(path);
    if (!res.ok) {
      this.logger.warn(`Keycloak groups request failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const groups = (await res.json()) as KeycloakGroup[];
    return this.findGroupInList(groups, groupName);
  }

  async listUsersInGroupWithCustomerCategory(groupName: string, first: number, max: number): Promise<KeycloakUserCustomerManagementRow[]> {
    if (!this.isConfigured()) return [];
    const group = await this.findGroupByName(groupName);
    if (!group) return [];
    const users = await this.getGroupMembers(group.id, first, max);
    const rows: KeycloakUserCustomerManagementRow[] = [];
    for (const u of users) {
      const groups = await this.getUserGroups(u.id);
      rows.push(this.rowFromUserAndGroups(u, groups));
    }
    return rows;
  }

  /**
   * Customer Management's STAFF filter. Unions across every configured lab-staff
   * group and de-duplicates by user id, so someone in both `damplab-staff` and
   * `technician` appears once.
   *
   * Pagination is applied to the merged list rather than per group: asking each
   * group for the same window and concatenating would skip rows once the groups
   * overlap.
   */
  async listLabStaffWithCustomerCategory(first: number, max: number): Promise<KeycloakUserCustomerManagementRow[]> {
    const byId = new Map<string, KeycloakUserCustomerManagementRow>();
    for (const groupName of this.labStaffGroupNames) {
      for (const row of await this.listUsersInGroupWithCustomerCategory(groupName, 0, first + max)) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return [...byId.values()].slice(first, first + max);
  }

  /**
   * List every user in the realm, paginated, with their derived pricing category.
   * Used by the customer management UI for the "All users" filter.
   */
  async listAllUsersWithCustomerCategory(first: number, max: number): Promise<KeycloakUserCustomerManagementRow[]> {
    if (!this.isConfigured()) return [];
    const path = `/admin/realms/${this.realm}/users?first=${encodeURIComponent(Math.max(first ?? 0, 0))}&max=${encodeURIComponent(Math.max(max ?? 0, 0))}`;
    const res = await this.fetchWithToken(path);
    if (!res.ok) {
      this.logger.warn(`Keycloak list users request failed: ${res.status} ${await res.text()}`);
      return [];
    }
    const users = (await res.json()) as KeycloakUser[];
    const rows: KeycloakUserCustomerManagementRow[] = [];
    for (const u of users) {
      const groups = await this.getUserGroups(u.id);
      rows.push(this.rowFromUserAndGroups(u, groups));
    }
    return rows;
  }

  /**
   * Get members of the configured lab staff group (e.g. damplab-staff).
   * Returns { id, displayName }[] where id is the Keycloak user id (same as sub in tokens).
   * Returns [] if Keycloak is not configured, group is missing, or the API fails.
   */
  async getLabStaffGroupMembers(): Promise<LabStaffMember[]> {
    if (!this.isConfigured()) {
      this.logger.log('Keycloak not configured (missing KEYCLOAK_SERVER_URL, KEYCLOAK_CLIENT_ID, or KEYCLOAK_CLIENT_SECRET); lab staff list will use LAB_MONITOR_STAFF env or be empty');
      return [];
    }

    try {
      // De-duplicated union across every configured group. A technician moved out of
      // damplab-staff must stay assignable, and someone in both groups must not
      // appear twice.
      const byId = new Map<string, LabStaffMember>();
      for (const groupName of this.labStaffGroupNames) {
        const group = await this.findGroupByName(groupName);
        if (!group) {
          // Not an error: `technician` legitimately does not exist until the realm
          // is updated, and this code must deploy first.
          this.logger.warn(`Keycloak group "${groupName}" not found in realm ${this.realm}. Check group name and service account roles (e.g. realm-management: query-groups, view-users).`);
          continue;
        }

        const path = `/admin/realms/${this.realm}/groups/${group.id}/members?max=-1`;
        const res = await this.fetchWithToken(path);
        if (!res.ok) {
          this.logger.warn(
            `Keycloak group members request failed for "${groupName}": ${res.status} ${await res.text()}. Ensure service account has realm-management role view-users (or query-users).`
          );
          continue;
        }

        for (const u of (await res.json()) as KeycloakUser[]) {
          if (byId.has(u.id)) continue;
          const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ')?.trim() || u.username || u.id;
          byId.set(u.id, { id: u.id, displayName, email: u.email });
        }
      }
      const members = [...byId.values()];
      this.logger.log(`Keycloak lab staff groups "${this.labStaffGroupNames.join(', ')}": ${members.length} member(s)`);
      return members;
    } catch (err) {
      this.logger.warn(`Keycloak getLabStaffGroupMembers failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
}
