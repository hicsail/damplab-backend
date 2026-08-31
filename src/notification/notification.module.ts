import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationEntity, NotificationEntitySchema } from './notification.model';
import { NotificationPreferencesEntity, NotificationPreferencesSchema } from './notification-preferences.model';
import { NotificationService } from './notification.service';
import { NotificationResolver } from './notification.resolver';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationEmailService } from './notification-email.service';
import { JobModule } from '../job/job.module';
import { KeycloakModule } from '../keycloak/keycloak.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NotificationEntity.name, schema: NotificationEntitySchema },
      { name: NotificationPreferencesEntity.name, schema: NotificationPreferencesSchema }
    ]),
    forwardRef(() => JobModule),
    KeycloakModule
  ],
  providers: [NotificationService, NotificationResolver, NotificationDispatchService, NotificationEmailService],
  exports: [NotificationDispatchService]
})
export class NotificationModule {}
