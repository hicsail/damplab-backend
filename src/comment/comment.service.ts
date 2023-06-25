import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Comment, CommentDocument } from './comment.model';
import { CreateComment } from './comment.dto';

@Injectable()
export class CommentService {
    constructor(@InjectModel(Comment.name) private commentModel: Model<CommentDocument>) {}

    async create(comment: Comment): Promise<Comment> {
        const newComment = new this.commentModel(comment);
        return newComment.save();
    }

    async findAll(): Promise<Comment[]> {
        return this.commentModel.find().exec();
    }
}



