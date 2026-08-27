import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Guide, GuideDocument } from './guide.model';
import { CreateGuideInput, UpdateGuideInput } from './dto/guide.input';

/**
 * Derive a URL segment from a title.
 *
 * Exported so the resolver's "omit slug and I'll make one" path and the seed
 * script agree on the answer.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

@Injectable()
export class TrainingService {
  constructor(
    @InjectModel(Guide.name)
    private readonly guideModel: Model<GuideDocument>
  ) {}

  /**
   * Guides, ordered for display: category, then `order`, then title.
   *
   * `includeDrafts` is the caller's *permission*, resolved by the resolver — not a
   * request parameter — so an unpublished guide cannot be read by asking nicely.
   */
  async findAll(includeDrafts: boolean): Promise<Guide[]> {
    const filter = includeDrafts ? {} : { isPublished: true };
    return this.guideModel.find(filter).sort({ category: 1, order: 1, title: 1 }).exec();
  }

  async findBySlug(slug: string, includeDrafts: boolean): Promise<Guide | null> {
    const filter = includeDrafts ? { slug } : { slug, isPublished: true };
    return this.guideModel.findOne(filter).exec();
  }

  private async assertSlugFree(slug: string, exceptId?: string): Promise<void> {
    const existing = await this.guideModel.findOne({ slug }).exec();
    if (existing && String(existing._id) !== exceptId) {
      throw new BadRequestException(`Another guide already uses the slug "${slug}".`);
    }
  }

  async create(input: CreateGuideInput, actor?: string): Promise<Guide> {
    const slug = slugify(input.slug?.trim() || input.title);
    if (!slug) {
      throw new BadRequestException('A guide needs a title that produces a usable URL slug.');
    }
    await this.assertSlugFree(slug);
    const created = new this.guideModel({
      ...input,
      slug,
      body: input.body ?? '',
      category: input.category?.trim() || 'General',
      // A new guide is a draft unless explicitly published. Publishing by default
      // would put half-written content on a customer-facing page.
      isPublished: input.isPublished ?? false,
      updatedBy: actor
    });
    return created.save();
  }

  async update(input: UpdateGuideInput, actor?: string): Promise<Guide> {
    const guide = await this.guideModel.findById(input.id).exec();
    if (!guide) {
      throw new NotFoundException('Guide not found');
    }
    if (input.slug !== undefined) {
      const slug = slugify(input.slug.trim() || guide.title);
      await this.assertSlugFree(slug, String(guide._id));
      guide.slug = slug;
    }
    if (input.title !== undefined) guide.title = input.title;
    if (input.category !== undefined) guide.category = input.category.trim() || 'General';
    if (input.body !== undefined) guide.body = input.body;
    if (input.order !== undefined) guide.order = input.order;
    if (input.isPublished !== undefined) guide.isPublished = input.isPublished;
    guide.updatedBy = actor;
    return guide.save();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.guideModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Guide not found');
    }
    return true;
  }

  /**
   * Insert a guide only if its slug is free.
   *
   * For seeding the two guides that were hardcoded JSX: running it twice must not
   * duplicate them, and it must never overwrite an edit someone has since made.
   *
   * **Atomic**, via `$setOnInsert` + `upsert`, rather than find-then-insert. The
   * naive version raced: two instances booting together both saw no document and
   * both inserted, and the unique index on `slug` killed the loser at startup.
   * Found exactly that way, running three backends at once.
   */
  async seedIfAbsent(input: CreateGuideInput): Promise<void> {
    const slug = slugify(input.slug?.trim() || input.title);
    if (!slug) return;
    await this.guideModel
      .updateOne(
        { slug },
        {
          $setOnInsert: {
            slug,
            title: input.title,
            category: input.category?.trim() || 'General',
            body: input.body ?? '',
            order: input.order ?? 0,
            isPublished: input.isPublished ?? false,
            updatedBy: 'seed'
          }
        },
        { upsert: true }
      )
      .exec();
  }
}
