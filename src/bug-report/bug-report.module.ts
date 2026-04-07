import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BugReport, BugReportSchema } from './bug-report.model';
import { BugReportService } from './bug-report.service';
import { BugReportResolver } from './bug-report.resolver';
import { BugReportAttachmentsService } from './bug-report-attachments.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: BugReport.name, schema: BugReportSchema }])],
  providers: [BugReportService, BugReportResolver, BugReportAttachmentsService]
})
export class BugReportModule {}
