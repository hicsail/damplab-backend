import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Guide, GuideSchema } from './guide.model';
import { TrainingService } from './training.service';
import { TrainingResolver } from './training.resolver';
import { SEED_GUIDES } from './seed-guides';

@Module({
  imports: [MongooseModule.forFeature([{ name: Guide.name, schema: GuideSchema }])],
  providers: [TrainingService, TrainingResolver],
  exports: [TrainingService]
})
export class TrainingModule implements OnModuleInit {
  private readonly logger = new Logger(TrainingModule.name);

  constructor(private readonly trainingService: TrainingService) {}

  /**
   * Port the two hardcoded guides into documents on first boot.
   *
   * Insert-if-absent, keyed on slug: running twice does not duplicate them, and an
   * edit made after seeding is never overwritten. Done here rather than in a
   * migration script because the content is the *replacement* for pages that are
   * being deleted — a Learning Hub with nothing in it would be a regression.
   */
  async onModuleInit(): Promise<void> {
    // Never let seeding stop the app booting. Content is not worth an outage, and
    // a first version of this crashed the process on a duplicate-key race.
    try {
      for (const guide of SEED_GUIDES) {
        await this.trainingService.seedIfAbsent(guide);
      }
    } catch (error) {
      this.logger.error(`Could not seed the Learning Hub guides: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
