import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { InventoryItem } from './inventory.model';
import { CreateInventoryItem } from './dtos/create.dto';
import { InventoryItemChange } from './dtos/update.dto';

@Injectable()
export class InventoryService {
  constructor(@InjectModel(InventoryItem.name) private readonly inventoryModel: Model<InventoryItem>) {}

  /**
   * Guarantees `placements` is an array, folding in the deprecated single
   * `stationId` for documents written before placements existed. Callers never
   * have to handle both shapes, so the backfill is an optimization rather than a
   * correctness requirement.
   */
  private normalize<T extends InventoryItem | null>(item: T): T {
    if (!item) return item;
    const doc = item as any;
    if (!Array.isArray(doc.placements) || doc.placements.length === 0) {
      doc.placements = doc.stationId ? [{ stationId: String(doc.stationId), quantity: 1 }] : [];
    } else {
      doc.placements = doc.placements
        .filter((p: any) => p?.stationId)
        .map((p: any) => ({ stationId: String(p.stationId), quantity: Math.max(1, Math.trunc(Number(p.quantity) || 1)) }));
    }
    return item;
  }

  private normalizeAll(items: InventoryItem[]): InventoryItem[] {
    return items.map((i) => this.normalize(i));
  }

  async find(id: string): Promise<InventoryItem | null> {
    return this.normalize(await this.inventoryModel.findById(id));
  }

  /** Returns active (non-deleted) items, then deleted items at the end. */
  async findAll(): Promise<InventoryItem[]> {
    return this.normalizeAll(await this.inventoryModel.find().sort({ isDeleted: 1, name: 1 }).exec());
  }

  /**
   * Active items placed at a station. Matches the placements array and also the
   * legacy single `stationId`, so un-backfilled documents still show up.
   */
  async findByStationId(stationId: string): Promise<InventoryItem[]> {
    return this.normalizeAll(
      await this.inventoryModel
        .find({
          isDeleted: { $ne: true },
          $or: [{ 'placements.stationId': stationId }, { stationId }]
        })
        .exec()
    );
  }

  /** Active-only — for catalog pickers (service editor, lab monitor). */
  async findAllActive(): Promise<InventoryItem[]> {
    return this.normalizeAll(
      await this.inventoryModel.find({ $or: [{ isDeleted: false }, { isDeleted: { $exists: false } }] }).sort({ name: 1 }).exec()
    );
  }

  /** Bulk lookup, preserves the requested order. */
  async findByIds(ids: Array<string | mongoose.Types.ObjectId>): Promise<InventoryItem[]> {
    if (!ids?.length) return [];
    const docs = await this.inventoryModel.find({ _id: { $in: ids } }).exec();
    const byId = new Map<string, InventoryItem>(docs.map((d) => [String((d as any)._id), d as unknown as InventoryItem]));
    const out: InventoryItem[] = [];
    for (const id of ids) {
      const hit = byId.get(String(id));
      if (hit) out.push(this.normalize(hit));
    }
    return out;
  }

  async create(item: CreateInventoryItem): Promise<InventoryItem> {
    return this.inventoryModel.create(item);
  }

  async update(item: InventoryItem, changes: InventoryItemChange): Promise<InventoryItem> {
    await this.inventoryModel.updateOne({ _id: (item as any).id ?? (item as any)._id }, changes);
    return (await this.find(((item as any).id ?? (item as any)._id) as string))!;
  }

  /** Soft delete — preserves history, hides from active pickers. */
  async softDelete(item: InventoryItem): Promise<void> {
    await this.inventoryModel.updateOne({ _id: (item as any).id ?? (item as any)._id }, { $set: { isDeleted: true } });
  }
}
