import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BugReportService } from '../bug-report/bug-report.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationEmailService } from '../notification/notification-email.service';

const EVENT_TYPE = 'BUG_DEPLOYED_TO_STAGING';

@Injectable()
export class BugDeployNotifierService {
  private readonly logger = new Logger(BugDeployNotifierService.name);

  constructor(
    private readonly bugReportService: BugReportService,
    private readonly notificationService: NotificationService,
    private readonly emailService: NotificationEmailService
  ) {}

  async notifyDeployedToStaging(sourceBugId: string, cardTitle: string): Promise<{ reporterEmail: string }> {
    const bug = await this.bugReportService.findById(sourceBugId);
    if (!bug) throw new BadRequestException('Bug report not found.');
    if (!bug.reporterEmail) throw new BadRequestException('Bug report has no reporter email.');

    const title = 'Bug fix deployed to staging';
    const message = `Your reported bug "${cardTitle}" has been deployed to the staging environment. Please validate the fix and add a comment on the backlog card if the issue persists.`;
    const link = '/bug-backlog';
    const operationId = `${EVENT_TYPE}:${sourceBugId}`;

    try {
      const notification: any = await this.notificationService.createIdempotent({
        recipientSub: `email:${bug.reporterEmail}`,
        recipientEmail: bug.reporterEmail,
        eventType: EVENT_TYPE,
        title,
        message,
        link,
        actorDisplayName: 'DampLab Team',
        operationId
      });

      this.emailService.send({
        to: bug.reporterEmail,
        subject: `[DampLab] ${title}`,
        title,
        message,
        link
      });

      if (notification?._id) {
        await this.notificationService.markEmailSent(String(notification._id));
      }
    } catch (err: any) {
      this.logger.warn(`Failed to notify reporter for bug ${sourceBugId}: ${err?.message}`);
    }

    return { reporterEmail: bug.reporterEmail };
  }
}
