import { InputType, Field} from '@nestjs/graphql';
import { Job } from '../job/job.model';
import mongoose from 'mongoose';

@InputType()
export class CreateComment {
    @Field( { description: 'Comment text message ' } ) 
    message: string;

    //@Field(() => Job,  {description: 'Job which the comment is under'})
    job: mongoose.Types.ObjectId;
}