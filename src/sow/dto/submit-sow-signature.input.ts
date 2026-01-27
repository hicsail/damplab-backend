import { InputType, Field, ID } from '@nestjs/graphql';
import { SOWSignatureRole } from '../sow.model';

@InputType()
export class SubmitSOWSignatureInput {
  @Field(() => ID, { description: 'ID of the SOW to sign' })
  sowId: string;

  @Field(() => SOWSignatureRole, { description: 'Role of the signer: CLIENT or TECHNICIAN' })
  role: SOWSignatureRole;

  @Field({ description: 'Full name as shown on the PDF' })
  name: string;

  @Field({ description: 'Role/title (e.g. Principal Investigator)', nullable: true })
  title?: string;

  @Field({ description: 'ISO 8601 date-time when they signed (e.g. 2025-01-26T14:30:00.000Z)' })
  signedAt: string;

  @Field({
    description: 'Data URL of the signature image (e.g. data:image/png;base64,...). Max 500KB.',
    nullable: true
  })
  signatureDataUrl?: string;
}
