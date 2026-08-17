import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { ApiKey, ApiKeyDocument } from './api-key.model';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

@Injectable()
export class ApiKeyService {
  constructor(@InjectModel(ApiKey.name) private readonly model: Model<ApiKeyDocument>) {}

  /** Create a key. Returns the stored record AND the one-time raw secret. */
  async create(name: string, createdBy?: string, expiresAt?: Date | null): Promise<{ apiKey: ApiKey; key: string }> {
    const raw = 'dl_' + randomBytes(24).toString('hex'); // dl_ + 48 hex chars
    const doc = await this.model.create({
      name: (name || 'Unnamed key').trim(),
      prefix: raw.slice(0, 11),
      hashedKey: sha256(raw),
      scope: 'read',
      createdBy,
      createdAt: new Date(),
      revoked: false,
      expiresAt: expiresAt ?? undefined
    });
    return { apiKey: doc, key: raw };
  }

  async list(): Promise<ApiKey[]> {
    return this.model.find().sort({ createdAt: -1 }).exec();
  }

  async revoke(id: string): Promise<ApiKey> {
    const updated = await this.model.findByIdAndUpdate(id, { $set: { revoked: true, revokedAt: new Date() } }, { new: true }).exec();
    if (!updated) throw new NotFoundException('API key not found.');
    return updated;
  }

  /**
   * Verify a raw key. Returns the record if valid (not revoked, not expired),
   * else null. Best-effort updates lastUsedAt. Used by the auth guard.
   */
  async verify(rawKey: string): Promise<ApiKey | null> {
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.startsWith('dl_')) return null;
    const doc = await this.model.findOne({ hashedKey: sha256(rawKey) }).exec();
    if (!doc) return null;
    if (doc.revoked) return null;
    if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) return null;
    // fire-and-forget last-used stamp
    this.model
      .updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } })
      .exec()
      .catch(() => undefined);
    return doc;
  }
}
