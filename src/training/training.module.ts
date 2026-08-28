import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TrainingResource, TrainingResourceSchema } from './training-resource.model';
import { TrainingService } from './training.service';
import { TrainingResolver } from './training.resolver';
import { TrainingFilesService } from './training-files.service';

/**
 * The Learning Hub.
 *
 * No `onModuleInit` any more: two markdown guides used to be seeded on every boot,
 * back when the hub held documents written in the app. It holds uploaded PDFs now,
 * and there is nothing to seed — the exported markdown lives in
 * `docs/legacy-learning-hub/` for whoever wants to convert and upload it.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: TrainingResource.name, schema: TrainingResourceSchema }])],
  providers: [TrainingService, TrainingResolver, TrainingFilesService],
  exports: [TrainingService]
})
export class TrainingModule {}
