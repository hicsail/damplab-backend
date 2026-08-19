import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SowTextPreset, SowTextPresetDocument, SowPresetSection } from './sow-text-preset.model';
import { SOW_FIELD_CATALOG, SOW_PROSE_DEFAULTS } from '../sow/sow-field-defaults';
import { SowFieldKind } from '../sow/sow-version.model';

/** Blocks are ranked 10, 20, 30… so one can be slotted between two others later. */
const ORDER_STEP = 10;

export interface PresetAuthor {
  sub: string;
  name: string;
}

/** The sections that have a text-block library: every prose section, in document order. */
export function proseSectionDefinitions(): Array<{ key: string; label: string }> {
  return SOW_FIELD_CATALOG.filter((def) => def.kind === SowFieldKind.PROSE).map((def) => ({ key: def.key, label: def.label }));
}

@Injectable()
export class SowTextPresetService implements OnModuleInit {
  private readonly logger = new Logger(SowTextPresetService.name);

  constructor(@InjectModel(SowTextPreset.name) private readonly presetModel: Model<SowTextPresetDocument>) {}

  async onModuleInit(): Promise<void> {
    await this.seedIfEmpty();
  }

  /**
   * Turns the prose that used to live only in SOW_PROSE_DEFAULTS into editable
   * blocks, once.
   *
   * The guard is that the *whole collection* is empty, not that a given section
   * is. Seeding per-section would resurrect a section every restart after staff
   * deliberately deleted its last block — the emptiness would be read as "never
   * seeded" rather than as the decision it was.
   */
  async seedIfEmpty(): Promise<number> {
    if ((await this.presetModel.estimatedDocumentCount().exec()) > 0) return 0;

    const now = new Date();
    // The three prose sections with an empty default (Additional Information,
    // Client Project Manager, Client Cost Center) get no block: seeding one would
    // put an empty "Default" in a dropdown, which says nothing to whoever opens it.
    const seeds = proseSectionDefinitions()
      .filter(({ key }) => (SOW_PROSE_DEFAULTS[key] ?? '').trim() !== '')
      .map(({ key }) => ({
        sectionKey: key,
        name: 'Default',
        text: SOW_PROSE_DEFAULTS[key],
        order: ORDER_STEP,
        createdBy: 'system',
        createdByName: 'DAMP Lab',
        createdAt: now,
        updatedBy: 'system',
        updatedByName: 'DAMP Lab',
        updatedAt: now
      }));

    if (seeds.length === 0) return 0;
    await this.presetModel.insertMany(seeds);
    this.logger.log(`Seeded ${seeds.length} default SOW text blocks`);
    return seeds.length;
  }

  /** One section's blocks, default first. */
  async listForSection(sectionKey: string): Promise<SowTextPresetDocument[]> {
    return this.presetModel.find({ sectionKey }).sort({ order: 1, createdAt: 1 }).exec();
  }

  /** Every block, grouped implicitly by the sort — one round-trip for the SOW editor. */
  async listAll(): Promise<SowTextPresetDocument[]> {
    return this.presetModel.find().sort({ sectionKey: 1, order: 1, createdAt: 1 }).exec();
  }

  /**
   * The default text for each section that has a block, keyed by section key.
   * This is what a newly generated SOW's prose sections are built from.
   */
  async defaultTextByKey(): Promise<Record<string, string>> {
    const all = await this.listAll();
    const out: Record<string, string> = {};
    for (const preset of all) {
      // Sorted by order, so the first one seen for a section is its default.
      if (!(preset.sectionKey in out)) out[preset.sectionKey] = preset.text ?? '';
    }
    return out;
  }

  /** Section rows for the Catalog Editor, derived from the catalog so the table cannot drift from the document. */
  async listSections(): Promise<SowPresetSection[]> {
    const all = await this.listAll();
    return proseSectionDefinitions().map(({ key, label }) => {
      const forSection = all.filter((p) => p.sectionKey === key);
      const mostRecent = forSection.reduce<SowTextPresetDocument | null>((latest, p) => (latest && latest.updatedAt >= p.updatedAt ? latest : p), null);
      return {
        key,
        label,
        presetCount: forSection.length,
        defaultName: forSection[0]?.name,
        updatedAt: mostRecent?.updatedAt,
        updatedByName: mostRecent?.updatedByName
      };
    });
  }

  async create(sectionKey: string, name: string, text: string, author: PresetAuthor): Promise<SowTextPresetDocument> {
    const last = await this.presetModel.findOne({ sectionKey }).sort({ order: -1 }).exec();
    const now = new Date();
    return this.presetModel.create({
      sectionKey,
      name: name.trim() || 'Untitled block',
      text: text ?? '',
      // New blocks land at the bottom: becoming the section default is something
      // staff do deliberately by dragging, never a side effect of adding.
      order: (last?.order ?? 0) + ORDER_STEP,
      createdBy: author.sub,
      createdByName: author.name,
      createdAt: now,
      updatedBy: author.sub,
      updatedByName: author.name,
      updatedAt: now
    });
  }

  async update(id: string, changes: { name?: string; text?: string }, author: PresetAuthor): Promise<SowTextPresetDocument> {
    const patch: Record<string, unknown> = { updatedBy: author.sub, updatedByName: author.name, updatedAt: new Date() };
    if (changes.name !== undefined) patch.name = changes.name.trim() || 'Untitled block';
    if (changes.text !== undefined) patch.text = changes.text;

    const updated = await this.presetModel.findByIdAndUpdate(id, patch, { new: true }).exec();
    if (!updated) throw new NotFoundException(`SOW text block ${id} not found`);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.presetModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException(`SOW text block ${id} not found`);
    return true;
  }

  /**
   * Renumbers a section from a client-supplied order. Ids that do not belong to
   * the section are ignored, and any block the client omitted keeps its place at
   * the end — a partial request reorders what it named rather than losing the rest.
   */
  async reorder(sectionKey: string, orderedIds: string[]): Promise<SowTextPresetDocument[]> {
    const existing = await this.listForSection(sectionKey);
    const byId = new Map(existing.map((p) => [String(p._id), p]));

    const named = orderedIds.map((id) => byId.get(String(id))).filter((p): p is SowTextPresetDocument => !!p);
    const namedIds = new Set(named.map((p) => String(p._id)));
    const rest = existing.filter((p) => !namedIds.has(String(p._id)));

    await Promise.all([...named, ...rest].map((preset, i) => this.presetModel.updateOne({ _id: preset._id }, { order: (i + 1) * ORDER_STEP }).exec()));

    return this.listForSection(sectionKey);
  }
}
