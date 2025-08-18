import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Template, TemplateSchema } from './template.model';
import { TemplateService } from './template.service';
import { TemplateResolver } from './template.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Template.name, schema: TemplateSchema }])
  ],
  providers: [TemplateService, TemplateResolver],
  exports: [TemplateService]
})
export class TemplateModule {}
