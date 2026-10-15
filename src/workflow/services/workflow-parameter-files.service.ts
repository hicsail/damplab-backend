import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

export interface WorkflowParameterPresignedUploadRequest {
  userSub: string;
  clientToken: string;
  filename: string;
  contentType: string;
  size: number;
  /**
   * Where in the bucket the object lands. Defaults to the per-user
   * `workflow-parameters/{sub}/` prefix that submission uploads use; the
   * samples-spreadsheet template upload passes its own so a catalog template
   * never sits under a customer's upload prefix.
   */
  keyPrefix?: string;
}

export interface WorkflowParameterPresignedUploadResponse {
  clientToken: string;
  filename: string;
  uploadUrl: string;
  key: string;
  contentType: string;
  size: number;
}

/** An object larger than the caller is prepared to read. */
export class ObjectTooLargeError extends Error {
  constructor() {
    super('The stored object is larger than the read limit.');
    this.name = 'ObjectTooLargeError';
  }
}

@Injectable()
export class WorkflowParameterFilesService {
  private readonly s3: S3Client | null;
  private readonly bucket: string | null;
  private readonly urlExpirationSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION');
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');
    this.bucket = this.configService.get<string>('WORKFLOW_PARAMETER_FILES_BUCKET') ?? this.configService.get<string>('JOB_ATTACHMENTS_BUCKET') ?? null;
    this.urlExpirationSeconds = Number(this.configService.get<string>('JOB_ATTACHMENTS_UPLOAD_URL_TTL', '900'));

    if (!region || !this.bucket) {
      this.s3 = null;
      return;
    }

    this.s3 = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle: !!endpoint
    });
  }

  async createPresignedUpload(request: WorkflowParameterPresignedUploadRequest): Promise<WorkflowParameterPresignedUploadResponse> {
    try {
      if (!this.s3 || !this.bucket) {
        throw new InternalServerErrorException('Workflow parameter file storage is not configured on the server.');
      }
      const safeFilename = request.filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
      const prefix = request.keyPrefix ?? `workflow-parameters/${request.userSub}/`;
      const key = `${prefix}${uuidv4()}-${safeFilename}`;
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: request.contentType,
        ContentLength: request.size
      });
      const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: this.urlExpirationSeconds });
      return {
        clientToken: request.clientToken,
        filename: request.filename,
        uploadUrl,
        key,
        contentType: request.contentType,
        size: request.size
      };
    } catch (err) {
      console.error('Failed to create S3 presigned URL for workflow parameter file', err);
      throw new InternalServerErrorException('Could not prepare upload URL for workflow parameter file');
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
      console.error('Failed to create S3 presigned download URL for workflow parameter file', err);
      return null;
    }
  }

  /**
   * The bytes of a stored object, for the server to read itself. Unlike the
   * presign methods this throws on every failure — unconfigured storage, a
   * missing object, an object over `maxBytes` — because its callers must refuse
   * a file they could not read rather than accept it unread. The caller decides
   * which keys may be read; this reads whatever key it is given.
   */
  async readObject(key: string, maxBytes: number): Promise<Buffer> {
    if (!this.s3 || !this.bucket) throw new Error('Workflow parameter file storage is not configured on the server.');
    const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = response.Body as (AsyncIterable<Uint8Array> & { destroy?: () => void }) | undefined;
    if (typeof response.ContentLength === 'number' && response.ContentLength > maxBytes) {
      // Release the pooled socket: an unread body holds it until it is destroyed.
      body?.destroy?.();
      throw new ObjectTooLargeError();
    }
    if (!body) throw new Error('The stored object has no body.');
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
      total += chunk.length;
      if (total > maxBytes) {
        body.destroy?.();
        throw new ObjectTooLargeError();
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
