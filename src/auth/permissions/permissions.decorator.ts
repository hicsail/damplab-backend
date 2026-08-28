import { SetMetadata, CustomDecorator } from '@nestjs/common';
import { Permission } from './permission.enum';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Require the caller to hold **all** the listed permissions.
 *
 * Note how this differs from `@Roles`, which requires *any* of its roles and which
 * the guard treats as "no metadata means allow". A handler carrying
 * `@RequirePermission` is denied whenever the resolved set falls short — the
 * permission check fails closed, deliberately, because attaching it to a method is
 * an explicit statement that the method is restricted.
 *
 * The two mechanisms coexist: `@Roles(Role.DamplabStaff)` keeps working everywhere
 * it is used today, and is evaluated in addition to this.
 */
export const RequirePermission = (...permissions: Permission[]): CustomDecorator<string> => SetMetadata(PERMISSIONS_KEY, permissions);
