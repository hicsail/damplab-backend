import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ApiKey, ApiKeySchema } from './api-key.model';
import { ApiKeyService } from './api-key.service';
import { ApiKeyResolver } from './api-key.resolver';

/**
 * Global so AuthRolesGuard (instantiated per-resolver across every module) can
 * inject ApiKeyService, mirroring how the JwtModule is registered global.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: ApiKey.name, schema: ApiKeySchema }])],
  providers: [ApiKeyService, ApiKeyResolver],
  exports: [ApiKeyService]
})
export class ApiKeyModule {}
