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
}

export interface WorkflowParameterPresignedUploadResponse {
  clientToken: string;
  filename: string;
  uploadUrl: string;
  key: string;
  contentType: string;
  size: number;
}

@Injectable()
export class WorkflowParameterFilesService {
  private readonly s3: S3Client | null;
  private readonly bucket: string | null;
  private readonly urlExpirationSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION');
    const endpoint = this.configService.get<string>('AWS_S3_ENDPOINT');
    this.bucket =
      this.configService.get<string>('WORKFLOW_PARAMETER_FILES_BUCKET') ??
      this.configService.get<string>('JOB_ATTACHMENTS_BUCKET') ??
      null;
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

  async createPresignedUpload(
    request: WorkflowParameterPresignedUploadRequest
  ): Promise<WorkflowParameterPresignedUploadResponse> {
    try {
      if (!this.s3 || !this.bucket) {
        throw new InternalServerErrorException('Workflow parameter file storage is not configured on the server.');
      }
      const safeFilename = request.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `workflow-parameters/${request.userSub}/${uuidv4()}-${safeFilename}`;
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
}
