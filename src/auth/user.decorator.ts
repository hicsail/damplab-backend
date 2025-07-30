import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { User } from './user.interface';

export const CurrentUser = createParamDecorator((data: unknown, context: ExecutionContext): User => {
  let request;
  if (context.getType() === 'http') {
    request = context.switchToHttp().getRequest();
  } else if (context.getType<GqlContextType>() === 'graphql') {
    request = GqlExecutionContext.create(context).getContext().req;
  }
  return request.user;
});
