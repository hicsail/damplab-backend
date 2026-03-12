import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface LabStaffMember {
  id: string;
  displayName: string;
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
      client_secret: this.clientSecret,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Keycloak token request failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error('Keycloak token response missing access_token');
    return data.access_token;
  }

  private async fetchWithToken(path: string): Promise<Response> {
    const token = await this.getAccessToken();
    const base = this.serverUrl!.replace(/\/$/, '');
    const url = path.startsWith('http') ? path : `${base}${path}`;
    return fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
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
        const displayName =
          [u.firstName, u.lastName].filter(Boolean).join(' ')?.trim() || u.username || u.id;
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
