import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Comment, CommentDocument, CommentAuthorType } from './comment.model';
import { CreateCommentInput } from './comment.dto';
import { UpdateCommentInput } from './comment.dto';
import { JobService } from '../job/job.service';

@Injectable()
export class CommentService {
  constructor(
    @InjectModel(Comment.name) private commentModel: Model<CommentDocument>,
    @Inject(forwardRef(() => JobService))
    private readonly jobService: JobService
  ) {}

  /**
   * Validate comment input
   */
  private validateCommentInput(input: CreateCommentInput): void {
    if (!input.content || input.content.trim().length === 0) {
      throw new BadRequestException('Comment content cannot be empty');
    }

    if (!input.author || input.author.trim().length === 0) {
      throw new BadRequestException('Comment author cannot be empty');
    }

    if (!input.authorType || !Object.values(CommentAuthorType).includes(input.authorType)) {
      throw new BadRequestException('Invalid authorType. Must be STAFF or CLIENT');
    }

    // Clients cannot create internal comments
    if (input.authorType === CommentAuthorType.CLIENT && input.isInternal === true) {
      throw new BadRequestException('Clients cannot create internal comments');
    }
  }

  /**
   * Create a new comment
   */
  async create(input: CreateCommentInput): Promise<Comment> {
    // Validate job exists
    const job = await this.jobService.findById(input.jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    }

    // Validate input
    this.validateCommentInput(input);

    const commentData = {
      jobId: input.jobId,
      content: input.content.trim(),
      author: input.author.trim(),
      authorType: input.authorType,
      isInternal: input.isInternal ?? false,
      createdAt: new Date()
    };

    const comment = await this.commentModel.create(commentData);
    return comment;
  }

  /**
   * Update an existing comment
   */
  async update(id: string, input: UpdateCommentInput): Promise<Comment> {
    const comment = await this.commentModel.findById(id).exec();
    if (!comment) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    const updateData: any = {
      updatedAt: new Date()
    };

    if (input.content !== undefined) {
      if (!input.content || input.content.trim().length === 0) {
        throw new BadRequestException('Comment content cannot be empty');
      }
      updateData.content = input.content.trim();
    }

    if (input.isInternal !== undefined) {
      // Clients cannot make comments internal
      if (comment.authorType === CommentAuthorType.CLIENT && input.isInternal === true) {
        throw new BadRequestException('Clients cannot make comments internal');
      }
      updateData.isInternal = input.isInternal;
    }

    const updated = await this.commentModel.findByIdAndUpdate(id, { $set: updateData }, { new: true }).exec();
    if (!updated) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    return updated;
  }

  /**
   * Delete a comment
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.commentModel.findByIdAndDelete(id).exec();
    return !!result;
  }

  /**
   * Find comment by ID
   */
  async findById(id: string): Promise<Comment | null> {
    return this.commentModel.findById(id).exec();
  }

  /**
   * Find all comments for a job
   */
  async findByJob(jobId: string): Promise<Comment[]> {
    return this.commentModel.find({ jobId }).sort({ createdAt: -1 }).exec();
  }

  /**
   * Find comments for a job, filtered by visibility
   * @param jobId - Job ID
   * @param isStaff - Whether the requester is staff (true) or client (false)
   */
  async findByJobWithVisibility(jobId: string, isStaff: boolean): Promise<Comment[]> {
    if (isStaff) {
      // Staff can see all comments
      return this.commentModel.find({ jobId }).sort({ createdAt: -1 }).exec();
    } else {
      // Clients can only see non-internal comments
      return this.commentModel.find({ jobId, isInternal: false }).sort({ createdAt: -1 }).exec();
    }
  }

  /**
   * Find all comments (for admin purposes)
   */
  async findAll(): Promise<Comment[]> {
    return this.commentModel.find().sort({ createdAt: -1 }).exec();
  }
}
