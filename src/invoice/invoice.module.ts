import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from './invoice.model';
import { InvoiceService } from './invoice.service';
import { InvoiceResolver } from './invoice.resolver';
import { JobModule } from '../job/job.module';
import { SOWModule } from '../sow/sow.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: Invoice.name, schema: InvoiceSchema }]), forwardRef(() => JobModule), forwardRef(() => SOWModule)],
  providers: [InvoiceService, InvoiceResolver],
  exports: [InvoiceService]
})
export class InvoiceModule {}
