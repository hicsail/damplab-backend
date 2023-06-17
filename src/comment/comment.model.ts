import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Job } from '../job/job.model'


// define mongoose schema 
@Schema()
class Comment {
    @Prop()
    message: String;

    @Prop()
    job: Job;

}