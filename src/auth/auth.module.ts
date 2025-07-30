import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtSecretRequestType } from '@nestjs/jwt';
import * as jwksClient from 'jwks-rsa';
import * as jwt from 'jsonwebtoken';

/*
This auth module extracts JWTs from request headers and verifies them with
the configured keys endpoint. It does not issue tokens or deal with IdPs.
*/

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const client = jwksClient({
          jwksUri: configService.getOrThrow('auth.jwksEndpoint'),
          timeout: 30000
        });

        return {
          secretOrKeyProvider: async (requestType: JwtSecretRequestType /* unused */, tokenOrPayload: string, verifyOrSignOrOptions?: jwt.VerifyOptions | jwt.SignOptions /* unused */) => {
            const kid = jwt.decode(tokenOrPayload, { complete: true })?.header.kid;
            const key = await client.getSigningKey(kid);
            const signingKey = key.getPublicKey();
            return signingKey;
          }
        };
      },
      inject: [ConfigService]
    })
  ]
})
export class AuthModule {}
