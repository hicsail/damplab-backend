import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SowTextPreset, SowTextPresetSchema } from './sow-text-preset.model';
import { SowTextPresetService } from './sow-text-preset.service';
import { SowTextPresetResolver } from './sow-text-preset.resolver';

@Module({
  imports: [MongooseModule.forFeature([{ name: SowTextPreset.name, schema: SowTextPresetSchema }])],
  providers: [SowTextPresetService, SowTextPresetResolver],
  exports: [SowTextPresetService]
})
export class SowPresetModule {}
