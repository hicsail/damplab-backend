import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class UserInfo {
  @Field()
  sub: string;

  @Field()
  name: string;

  @Field()
  email: string;

  @Field(() => String, { nullable: true })
  picture?: string;
}

@ObjectType()
export class AuthResponse {
  @Field()
  token: string;

  @Field(() => UserInfo)
  userInfo: UserInfo;
}

@ObjectType()
export class LoginStatus {
  @Field()
  loggedIn: boolean;

  @Field(() => UserInfo, { nullable: true })
  userInfo?: UserInfo;
}
