import { Field, Int, ObjectType } from '@nestjs/graphql';

/** One protocol as the library list shows it, before you open it. */
@ObjectType({ description: 'A protocol in the library: enough to list it, not its steps.' })
export class ProtocolLibraryEntry {
  @Field({ description: 'protocols.io identifier or slug — what resolveProtocol takes.' })
  protocolId: string;

  @Field({ description: 'Protocol title, or the id if protocols.io could not be reached.' })
  title: string;

  @Field(() => Int, { nullable: true, description: 'How many steps it has. Null when the fetch failed.' })
  stepCount?: number;

  @Field(() => [String], { description: 'DAMPLab services that reference this protocol.' })
  serviceNames: string[];

  @Field(() => Boolean, {
    description: 'True when protocols.io could not be reached for this entry. The row still lists, so one bad protocol does not blank the library.'
  })
  unavailable: boolean;
}

@ObjectType({ description: 'One category heading in the protocol library.' })
export class ProtocolLibraryCategory {
  @Field({ description: "Category name, from the referencing service's category. 'Uncategorised' when no service references it." })
  category: string;

  @Field(() => [ProtocolLibraryEntry])
  protocols: ProtocolLibraryEntry[];
}
