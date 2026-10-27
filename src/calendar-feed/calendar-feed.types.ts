import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'A personal, secret iCalendar subscription URL for every equipment booking.' })
export class CalendarFeed {
  @Field({ description: 'Absolute URL a calendar app subscribes to. Anyone holding it can read item names and times.' })
  url: string;

  @Field({ description: 'When this link was created or last reset.' })
  createdAt: Date;
}
