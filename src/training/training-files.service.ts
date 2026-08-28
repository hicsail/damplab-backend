import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

/**
 * Presigned uploads and downloads for Learning Hub documents.
 *
 * Modelled on `job/job-attachments.service.ts`, sharing its bucket and TTL config —
 * the same reuse `CommentResolver` makes of that service. A separate class only
 * because the key prefix differs.
 *
 * Two things here that the three older attachment services do not do, and should:
 * the content type is checked against an allow-list, and the declared size is capped.
 * Those services take `ContentLength` from the client verbatim, which means a caller
 * can presign an upload of any size at all. New code, so it gets the checks.
 */
export const TRAINING_ALLOWED_CONTENT_TYPES = ['application/pdf'];

/** 50 MB. A lab protocol is a document, not a dataset. */
export const TRAINING_MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface TrainingPresignedUpload {
  filename: string;
  uploadUrl: string;
  key: string;
  contentType: string;
  size: number;
}

@Injectable()
export class TrainingFilesService {
  private readonly s3: S3Client | null;
  private readonly bucket: string | null;
  private readonly urlExpirationSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION');
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');
    this.bucket = this.configService.get<string>('JOB_ATTACHMENTS_BUCKET') ?? null;
    this.urlExpirationSeconds = Number(this.configService.get<string>('JOB_ATTACHMENTS_UPLOAD_URL_TTL', '900'));

    if (!region || !this.bucket) {
      // Leave the client null so usage fails with a clear message rather than the
      // process refusing to boot over a feature most of the app does not use.
      this.s3 = null;
      return;
    }
    this.s3 = new S3Client({ region, endpoint: endpoint || undefined, forcePathStyle: !!endpoint });
  }

  /** Rejects anything that is not a PDF, or is larger than the cap. */
  assertUploadable(contentType: string, size: number): void {
    if (!TRAINING_ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new BadRequestException(`Learning Hub documents must be PDFs. Received "${contentType}".`);
    }
    if (!Number.isFinite(size) || size <= 0) {
      throw new BadRequestException('File size is missing or not a positive number.');
    }
    if (size > TRAINING_MAX_FILE_BYTES) {
      throw new BadRequestException(`That file is ${Math.round(size / 1024 / 1024)} MB. The limit is ${TRAINING_MAX_FILE_BYTES / 1024 / 1024} MB.`);
    }
  }

  async createPresignedUpload(resourceId: string, filename: string, contentType: string, size: number): Promise<TrainingPresignedUpload> {
    this.assertUploadable(contentType, size);
    if (!this.s3 || !this.bucket) {
      throw new InternalServerErrorException('Document storage is not configured on the server (AWS_REGION, JOB_ATTACHMENTS_BUCKET).');
    }
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `training/${resourceId}/${uuidv4()}-${safeFilename}`;

    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: this.urlExpirationSeconds });
    return { filename, uploadUrl, key, contentType, size };
  }

  /**
   * A short-lived GET.
   *
   * Only ever called after the caller has been checked against the resource's
   * audience — this URL is a bearer token, and nothing downstream re-authorises it.
   */
  async createPresignedDownload(key: string, filename?: string): Promise<string | null> {
    try {
      if (!this.s3 || !this.bucket) return null;
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Makes the browser save it under its original name rather than the uuid-
        // prefixed object key.
        ResponseContentDisposition: filename ? `attachment; filename="${filename.replace(/"/g, '')}"` : undefined
      });
      return await getSignedUrl(this.s3, command, { expiresIn: this.urlExpirationSeconds });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to create S3 presigned download URL for a Learning Hub document', err);
      return null;
    }
  }
}
