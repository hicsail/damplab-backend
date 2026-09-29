import { BadRequestException, Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClickUpService } from './clickup.service';
import { BugDeployNotifierService } from './bug-deploy-notifier.service';

@Controller('api/webhooks/clickup')
export class ClickUpWebhookController {
  constructor(private readonly configService: ConfigService, private readonly clickUpService: ClickUpService, private readonly bugDeployNotifier: BugDeployNotifierService) {}

  @Post('staging-deployed')
  async handleStagingDeployed(@Headers('x-agent-secret') secret: string, @Body() body: { taskId: string }): Promise<{ ok: boolean; reporterEmail?: string }> {
    const expected = this.configService.get<string>('agent.webhookSecret');
    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Invalid webhook secret.');
    }

    if (!body?.taskId) {
      throw new BadRequestException('Missing taskId.');
    }

    const card = await this.clickUpService.getCard(body.taskId);
    if (!card.sourceBugId) {
      throw new BadRequestException('Card has no linked bug report.');
    }

    const result = await this.bugDeployNotifier.notifyDeployedToStaging(card.sourceBugId, card.title);
    return { ok: true, reporterEmail: result.reporterEmail };
  }
}
