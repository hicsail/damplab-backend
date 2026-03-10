import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

export interface PresignedUploadRequest {
  jobId: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface PresignedUploadResponse {
  filename: string;
  uploadUrl: string;
  key: string;
  contentType: string;
  size: number;
}

@Injectable()
export class JobAttachmentsService {
  private readonly s3: S3Client | null;
  private readonly bucket: string | null;
  private readonly urlExpirationSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION');
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');
    this.bucket = this.configService.get<string>('JOB_ATTACHMENTS_BUCKET') ?? null;
    this.urlExpirationSeconds = Number(this.configService.get<string>('JOB_ATTACHMENTS_UPLOAD_URL_TTL', '900'));

    if (!region || !this.bucket) {
      // S3 is not configured yet; leave client null so that usage will fail fast with a clear error
      this.s3 = null;
      return;
    }

    this.s3 =
      new S3Client({
        region,
        endpoint: endpoint || undefined,
        forcePathStyle: !!endpoint
      });
  }

  async createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUploadResponse> {
    try {
      if (!this.s3 || !this.bucket) {
        throw new InternalServerErrorException('Attachment storage is not configured on the server.');
      }
      const safeFilename = request.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `jobs/${request.jobId}/attachments/${uuidv4()}-${safeFilename}`;

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: request.contentType,
        ContentLength: request.size
      });

      const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: this.urlExpirationSeconds });

      return {
        filename: request.filename,
        uploadUrl,
        key,
        contentType: request.contentType,
        size: request.size
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to create S3 presigned URL for job attachment', err);
      throw new InternalServerErrorException('Could not prepare upload URL for attachment');
    }
  }

  async createPresignedDownload(key: string, contentType?: string): Promise<string | null> {
    try {
      if (!this.s3 || !this.bucket) {
        return null;
      }
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType
      });
      return await getSignedUrl(this.s3, command, { expiresIn: this.urlExpirationSeconds });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to create S3 presigned download URL for job attachment', err);
      return null;
    }
  }
}

