import { UseGuards } from '@nestjs/common';
import { Field, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../auth.guard';
import { CurrentUser } from '../user.decorator';
import { User } from '../user.interface';
import { customerPermissionsFor, permissionsFor } from './permissions';

@ObjectType({ description: "The caller's resolved permissions. The frontend never hardcodes the role -> permission table; it asks for the answer." })
export class MyPermissions {
  @Field(() => [String], { description: 'Everything the caller may do, unioned across all of their roles, including the client baseline.' })
  effective: string[];

  @Field(() => [String], {
    description:
      'The same, with staff-flavoured roles (damplab-staff, technician) removed — what the staff "Client View" toggle previews. Note client-unassisted-equipment-user is NOT removed; it is a client variant. For a non-staff caller this equals effective. This is a UI illusion only: the caller\'s real token is unchanged and retains full backend authority.'
  })
  asCustomer: string[];
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
      asCustomer: [...customerPermissionsFor(user)]
    };
  }
}
