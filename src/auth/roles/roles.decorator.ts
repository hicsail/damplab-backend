import { SetMetadata, CustomDecorator } from '@nestjs/common';
import { Role } from './roles.enum';

export const ROLES_KEY = 'roles';
export const IS_PUBLIC_KEY = 'isPublic';

export const Roles = (...roles: Role[]): CustomDecorator<string> => SetMetadata(ROLES_KEY, roles);
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
