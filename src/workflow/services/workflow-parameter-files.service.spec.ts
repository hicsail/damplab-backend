import { Readable } from 'stream';
import { ObjectTooLargeError, WorkflowParameterFilesService } from './workflow-parameter-files.service';

const config = (values: Record<string, string>): any => ({ get: (key: string, fallback?: string) => values[key] ?? fallback });

function serviceWith(send: jest.Mock): WorkflowParameterFilesService {
  const service = new WorkflowParameterFilesService(config({ AWS_REGION: 'us-east-1', WORKFLOW_PARAMETER_FILES_BUCKET: 'bucket' }));
  (service as any).s3 = { send };
  return service;
}

describe('WorkflowParameterFilesService.readObject', () => {
  it('returns the object bytes, asking for the stored key in the configured bucket', async () => {
    const send = jest.fn(async () => ({ ContentLength: 6, Body: Readable.from([Buffer.from('abc'), Buffer.from('def')]) }));
    await expect(serviceWith(send).readObject('workflow-parameters/u/a.csv', 10)).resolves.toEqual(Buffer.from('abcdef'));
    expect((send.mock.calls[0] as any)[0].input).toEqual({ Bucket: 'bucket', Key: 'workflow-parameters/u/a.csv' });
  });

  it('refuses an object whose declared length is over the cap, without reading it', async () => {
    const body = Readable.from([Buffer.from('x')]);
    const send = jest.fn(async () => ({ ContentLength: 11, Body: body }));
    await expect(serviceWith(send).readObject('k', 10)).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(body.destroyed).toBe(true);
  });

  it('refuses an object that turns out longer than the cap while it is read (no declared length)', async () => {
    const send = jest.fn(async () => ({ Body: Readable.from([Buffer.alloc(6), Buffer.alloc(6)]) }));
    await expect(serviceWith(send).readObject('k', 10)).rejects.toBeInstanceOf(ObjectTooLargeError);
  });

  it('throws — never returns empty bytes — when storage is not configured or the object is missing', async () => {
    const unconfigured = new WorkflowParameterFilesService(config({}));
    await expect(unconfigured.readObject('k', 10)).rejects.toThrow('not configured');
    const missing = jest.fn(async () => {
      throw new Error('NoSuchKey');
    });
    await expect(serviceWith(missing).readObject('k', 10)).rejects.toThrow('NoSuchKey');
    await expect(serviceWith(jest.fn(async () => ({}))).readObject('k', 10)).rejects.toThrow();
  });
});

describe('WorkflowParameterFilesService.createPresignedUpload', () => {
  it('mints a key with no run of dots in the file name, so the key passes the `..` guards', async () => {
    // A real (offline) client: signing a URL needs no network or credentials beyond these.
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    const service = new WorkflowParameterFilesService(config({ AWS_REGION: 'us-east-1', WORKFLOW_PARAMETER_FILES_BUCKET: 'bucket' }));
    const upload = await service.createPresignedUpload({ clientToken: 't', filename: 'Samples..final...xlsx', contentType: 'x', size: 1, userSub: 'u' } as any);
    expect(upload.key).toMatch(/^workflow-parameters\/u\/[0-9a-f-]{36}-Samples\.final\.xlsx$/);
  });
});
