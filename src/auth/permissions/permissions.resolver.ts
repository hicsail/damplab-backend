import { UseGuards } from '@nestjs/common';
import { Field, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../auth.guard';
import { CurrentUser } from '../user.decorator';
import { User } from '../user.interface';
import { AccessTier, LESSER_TIERS, TIER_LABEL, TIER_ROLE } from '../roles/access-tiers';
import { RequirePermission } from './permissions.decorator';
import { Permission } from './permission.enum';
import { permissionsForRoles } from './role-permissions';
import { customerPermissionsFor, permissionsFor } from './permissions';

@ObjectType({ description: "The caller's resolved permissions. The frontend never hardcodes the role -> permission table; it asks for the answer." })
export class MyPermissions {
  @Field(() => [String], { description: 'Everything the caller may do, unioned across all of their roles, including the client baseline.' })
  effective: string[];

  /**
   * **Vestigial as of the view-as dropdown.** No frontend path reads this any more —
   * `useEffectiveUser` takes its preview list from `rolePreviews` instead, which can
   * express all three lesser tiers rather than just "not staff".
   *
   * It stays because browsers still running the pre-deploy bundle request it, and a
   * field that disappears fails their whole `myPermissions` query, dropping them to
   * the legacy staff boolean. Remove it a release after the UI stops asking.
   */
  @Field(() => [String], {
    deprecationReason: 'Superseded by rolePreviews. Kept so pre-deploy clients do not break; safe to remove one release after the UI stops asking for it.',
    description:
      'The same, with staff-flavoured roles (damplab-staff, technician) removed — what the staff "Client View" toggle previewed before the view-as dropdown replaced it. Note client-unassisted-equipment-user is NOT removed; it is a client variant. For a non-staff caller this equals effective. This is a UI illusion only: the caller\'s real token is unchanged and retains full backend authority.'
  })
  asCustomer: string[];

  @Field(() => [String], {
    description:
      "The realm roles the *server* resolved for this caller. Exposed so the UI can detect DEV_AS_ROLES / VITE_DEV_AS_ROLES drift under the local auth bypass: only the backend's value decides what `effective` contains, so if the two halves disagree the UI renders one role's menu while claiming another. Discloses nothing — the caller's own token already carries these."
  })
  roles: string[];
}

@ObjectType({ description: 'One access tier an administrator may preview the UI as, with the permissions that tier resolves to.' })
export class RolePreview {
  @Field(() => AccessTier)
  tier: AccessTier;

  @Field(() => String, { description: 'Human label for the picker.' })
  label: string;

  @Field(() => [String], { description: 'Everything that tier may do, including the client baseline.' })
  permissions: string[];
}

@Resolver()
export class PermissionsResolver {
  /**
   * Deliberately has no `@Roles` and no `@RequirePermission`: any authenticated
   * caller must be able to ask what they may do, and the answer is derived from
   * their own token, so it discloses nothing they do not already hold.
   */
  @Query(() => MyPermissions, { description: 'The permissions granted to the calling user.' })
  @UseGuards(AuthRolesGuard)
  myPermissions(@CurrentUser() user: User): MyPermissions {
    return {
      effective: [...permissionsFor(user)],
      asCustomer: [...customerPermissionsFor(user)],
      roles: user?.realm_access?.roles ?? []
    };
  }

  /**
   * The tiers an administrator may preview the UI as, each with its resolved
   * permission list.
   *
   * Answered here rather than computed in the browser for the same reason
   * `myPermissions` is: the role -> permission table lives only in this package, and a
   * copy in the UI would drift. This reuses `permissionsForRoles` — the same function
   * the guard's own `permissionsFor` is built on — so a preview cannot disagree with
   * what the server would actually allow.
   *
   * Administrators only, matching the header control. That is also why the list is
   * safe to hand over wholesale: `customers:manage` belongs to the tier that already
   * holds every permission, so this discloses nothing the caller lacks.
   *
   * Fetched lazily by the header over Apollo, **not** folded into `myPermissions`.
   * That query runs in a module-level top-level await before Apollo exists, and asking
   * a not-yet-deployed backend for a field it lacks would fail the whole query and
   * drop every caller to the legacy staff boolean.
   */
  @Query(() => [RolePreview], { description: 'Access tiers the calling administrator may preview the UI as, lower tiers only.' })
  @UseGuards(AuthRolesGuard)
  @RequirePermission(Permission.CustomersManage)
  rolePreviews(): RolePreview[] {
    return LESSER_TIERS.map((tier) => {
      const role = TIER_ROLE[tier];
      return {
        tier,
        label: TIER_LABEL[tier],
        // CLIENT maps to no role, so this is `permissionsForRoles([])` — the baseline,
        // which is exactly what a user carrying nothing resolves to.
        permissions: [...permissionsForRoles(role ? [role] : [])]
      };
    });
  }
}
