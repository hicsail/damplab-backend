import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomerCategory } from '../job/job.model';
import { Role } from '../auth/roles/roles.enum';

export interface LabStaffMember {
  id: string;
  displayName: string;
}

export interface KeycloakUserCustomerManagementRow {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  customerCategory?: CustomerCategory;
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

/** Keycloak group names that affect pricing; must stay in sync with job submission logic. */
const CUSTOMER_PRICING_GROUP_NAMES: readonly string[] = [
  Role.InternalCustomer,
  Role.InternalCustomers,
  Role.ExternalCustomer,
  Role.ExternalCustomerAcademic,
  Role.ExternalCustomerMarket,
  Role.ExternalCustomerNoSalary
];

const CATEGORY_PRIMARY_GROUP: Record<CustomerCategory, string> = {
  [CustomerCategory.INTERNAL_CUSTOMERS]: Role.InternalCustomers,
  [CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC]: Role.ExternalCustomerAcademic,
  [CustomerCategory.EXTERNAL_CUSTOMER_MARKET]: Role.ExternalCustomerMarket,
  [CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY]: Role.ExternalCustomerNoSalary
};

@Injectable()
export class KeycloakService {
  private readonly logger = new Logger(KeycloakService.name);
  private readonly serverUrl: string | undefined;
  private readonly realm: string;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly labStaffGroupName: string;

  constructor(private readonly configService: ConfigService) {
    const kc = this.configService.get<{ serverUrl?: string; realm?: string; clientId?: string; clientSecret?: string; labStaffGroupName?: string }>('keycloak');
    this.serverUrl = kc?.serverUrl;
    this.realm = kc?.realm ?? 'damplab';
    this.clientId = kc?.clientId;
    this.clientSecret = kc?.clientSecret;
    this.labStaffGroupName = kc?.labStaffGroupName ?? 'damplab-staff';
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
    const path = `/admin/realms/${this.realm}/groups/${groupId}/members?first=${encodeURIComponent(
      Math.max(first ?? 0, 0)
    )}&max=${encodeURIComponent(Math.max(max ?? 0, 0))}`;
    const res = await this.fetchWithToken(path);
    if (!res.ok) {
      this.logger.warn(`Keycloak group members request failed: ${res.status} ${await res.text()}`);
      return [];
    }
    return (await res.json()) as KeycloakUser[];
  }

  private claimsFromGroupList(groups: { name?: string; path?: string }[]): string[] {
    const claims: string[] = [];
    for (const g of groups) {
      if (g.path) claims.push(g.path);
      if (g.name) claims.push(g.name);
    }
    return claims;
  }

  /** Same precedence as `JobResolver.createJob` / `AddNodeInputPipe`. */
  deriveCustomerCategoryFromGroups(groups: { name?: string; path?: string }[]): CustomerCategory | undefined {
    const claims = this.claimsFromGroupList(groups);
    const hasGroup = (groupName: string): boolean =>
      claims.some((entry) => entry === groupName || entry.endsWith(`/${groupName}`));
    if (hasGroup(Role.InternalCustomers) || hasGroup(Role.InternalCustomer)) return CustomerCategory.INTERNAL_CUSTOMERS;
    if (hasGroup(Role.ExternalCustomerAcademic)) return CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC;
    if (hasGroup(Role.ExternalCustomerMarket)) return CustomerCategory.EXTERNAL_CUSTOMER_MARKET;
    if (hasGroup(Role.ExternalCustomerNoSalary)) return CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY;
    if (hasGroup(Role.ExternalCustomer)) return CustomerCategory.EXTERNAL_CUSTOMER_MARKET;
    return undefined;
  }

  private isCustomerPricingGroupMember(g: { name?: string }): boolean {
    return Boolean(g.name && CUSTOMER_PRICING_GROUP_NAMES.includes(g.name));
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
    await this.removeUserFromAllCustomerPricingGroups(userId);
    if (category == null) return;
    const groupName = CATEGORY_PRIMARY_GROUP[category];
    const group = await this.findGroupByName(groupName);
    if (!group) {
      throw new Error(`Keycloak group "${groupName}" not found in realm ${this.realm}`);
    }
    await this.addUserToGroup(userId, group.id);
  }

  async getUserCustomerManagementRow(userId: string): Promise<KeycloakUserCustomerManagementRow | null> {
    const user = await this.getUserById(userId);
    if (!user) return null;
    const groups = await this.getUserGroups(userId);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      customerCategory: this.deriveCustomerCategoryFromGroups(groups)
    };
  }

  async searchUsersWithCustomerCategory(search: string, max: number): Promise<KeycloakUserCustomerManagementRow[]> {
    const users = await this.searchUsers(search, max);
    const rows: KeycloakUserCustomerManagementRow[] = [];
    for (const u of users) {
      const groups = await this.getUserGroups(u.id);
      rows.push({
        id: u.id,
        username: u.username,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        customerCategory: this.deriveCustomerCategoryFromGroups(groups)
      });
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

  async listUsersInGroupWithCustomerCategory(
    groupName: string,
    first: number,
    max: number
  ): Promise<KeycloakUserCustomerManagementRow[]> {
    if (!this.isConfigured()) return [];
    const group = await this.findGroupByName(groupName);
    if (!group) return [];
    const users = await this.getGroupMembers(group.id, first, max);
    const rows: KeycloakUserCustomerManagementRow[] = [];
    for (const u of users) {
      const groups = await this.getUserGroups(u.id);
      rows.push({
        id: u.id,
        username: u.username,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        customerCategory: this.deriveCustomerCategoryFromGroups(groups)
      });
    }
    return rows;
  }

  async listLabStaffWithCustomerCategory(first: number, max: number): Promise<KeycloakUserCustomerManagementRow[]> {
    return this.listUsersInGroupWithCustomerCategory(this.labStaffGroupName, first, max);
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
      const group = await this.findGroupByName(this.labStaffGroupName);
      if (!group) {
        this.logger.warn(`Keycloak group "${this.labStaffGroupName}" not found in realm ${this.realm}. Check group name and service account roles (e.g. realm-management: query-groups, view-users).`);
        return [];
      }

      const path = `/admin/realms/${this.realm}/groups/${group.id}/members?max=-1`;
      const res = await this.fetchWithToken(path);
      if (!res.ok) {
        this.logger.warn(`Keycloak group members request failed: ${res.status} ${await res.text()}. Ensure service account has realm-management role view-users (or query-users).`);
        return [];
      }

      const users = (await res.json()) as KeycloakUser[];
      const members = users.map((u) => {
        const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ')?.trim() || u.username || u.id;
        return { id: u.id, displayName };
      });
      this.logger.log(`Keycloak lab staff group "${this.labStaffGroupName}": ${members.length} member(s)`);
      return members;
    } catch (err) {
      this.logger.warn(`Keycloak getLabStaffGroupMembers failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
}
