# Keycloak integration (lab monitor staff list)

The backend can load the lab monitor assignee list from a Keycloak realm group (e.g. `damplab-staff`) via the Admin REST API.

## Fixing "403 Forbidden" on groups

If logs show **Keycloak groups request failed: 403**, the service account cannot list groups.

**Quick fix:** Clients → **damplab-backend** → **Service account roles** tab → **Assign role** → in the dropdown switch to **realm-management** (client roles, not realm roles) → assign **query-groups** and **view-users** → Assign. No restart needed.

## Required: service account roles

The client you created (e.g. `damplab-backend`) must have **Service account** enabled and its service account must be assigned roles that allow:

1. **Listing/searching groups** – so we can find the `damplab-staff` group  
2. **Reading group members** – so we can list users in that group  

In Keycloak those permissions come from the **realm-management** client:

1. In Keycloak Admin: **Clients** → your client (e.g. `damplab-backend`) → **Service account roles** tab.
2. Click **Assign role**.
3. Filter by **realm-management** (or choose “Filter by clients” and pick `realm-management`).
4. Assign at least:
   - **query-groups** (or **view-groups**) – needed for `GET /admin/realms/{realm}/groups`
   - **view-users** (or **query-users**) – needed for `GET /admin/realms/{realm}/groups/{id}/members`

If you prefer to give broader access, you can assign **realm-management** → **realm-admin** to the service account (not recommended for production).

## Check backend logs

After setting env and restarting the backend, when someone calls `getLabMonitorStaffList` you should see one of:

- `Keycloak not configured` → env vars not set or not loaded (check `.env` and that the process was restarted).
- `Keycloak group "damplab-staff" not found` → group name wrong or service account missing **query-groups** / **view-groups**.
- `Keycloak group members request failed: 403` → service account missing **view-users** / **query-users**.
- `Keycloak lab staff group "damplab-staff": N member(s)` → success.

Log level must show debug for the “not configured” and “N member(s)” messages; warn is always logged for failures.
