import { Module, forwardRef } from '@nestjs/common';
import { ClickUpService } from './clickup.service';
import { ClickUpResolver } from './clickup.resolver';
import { BugDeployNotifierService } from './bug-deploy-notifier.service';
import { ClickUpWebhookController } from './clickup-webhook.controller';
import { BugReportModule } from '../bug-report/bug-report.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [forwardRef(() => BugReportModule), NotificationModule],
  controllers: [ClickUpWebhookController],
  providers: [ClickUpService, ClickUpResolver, BugDeployNotifierService],
  exports: [ClickUpService, BugDeployNotifierService]
})
export class ClickUpModule {}
