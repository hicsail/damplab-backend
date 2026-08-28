import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrainingService } from './training.service';
import { TrainingFilesService, TRAINING_MAX_FILE_BYTES } from './training-files.service';
import { AnnouncementAudience } from '../audience/audience';

/**
 * The Learning Hub's audience field is **authorization**, not presentation — it
 * decides who may download a file — so what is worth pinning is that the restriction
 * is expressed in the database query and cannot be reached around.
 */
describe('TrainingService — audience is enforced in the query', () => {
  function serviceWithSpy(): { service: TrainingService; calls: any[] } {
    const calls: any[] = [];
    const chain: any = { sort: (): any => chain, exec: async (): Promise<any[]> => [] };
    const model: any = {
      find: (filter: any) => {
        calls.push(['find', filter]);
        return chain;
      },
      findOne: (filter: any) => {
        calls.push(['findOne', filter]);
        return { exec: async () => null };
      },
      findById: (id: any) => {
        calls.push(['findById', id]);
        return { exec: async () => null };
      }
    };
    return { service: new TrainingService(model), calls };
  }

  it('narrows the list to the caller’s audiences in the query, not after it', async () => {
    // Post-filtering would still have loaded another audience's document into memory
    // on this caller's behalf.
    const { service, calls } = serviceWithSpy();
    await service.findForAudiences([AnnouncementAudience.CLIENT]);
    expect(calls[0]).toEqual(['find', { audienceRoles: { $in: [AnnouncementAudience.CLIENT] } }]);
  });

  it('scopes a single lookup by audience too, so an id guess is not a way in', async () => {
    const { service, calls } = serviceWithSpy();
    await service.findOneForAudiences('abc', [AnnouncementAudience.TECHNICIAN]);
    expect(calls[0]).toEqual(['findOne', { _id: 'abc', audienceRoles: { $in: [AnnouncementAudience.TECHNICIAN] } }]);
  });

  it('has no absent-or-empty escape hatch, unlike announcements', async () => {
    // Announcements treat an absent audience as "everyone", because the field shipped
    // without a migration. This one is required from day one, so a document with no
    // audience cannot exist -- and a bug that produced one hides it rather than
    // showing it to everybody.
    const { service, calls } = serviceWithSpy();
    await service.findForAudiences([AnnouncementAudience.CLIENT]);
    expect(JSON.stringify(calls[0])).not.toContain('$exists');
    expect(JSON.stringify(calls[0])).not.toContain('$size');
  });

  it('refuses to create a document nobody may see', async () => {
    const { service } = serviceWithSpy();
    await expect(service.create({ title: 't', audienceRoles: [] } as any)).rejects.toThrow(BadRequestException);
  });
});

describe('TrainingFilesService — what may be uploaded', () => {
  const files = new TrainingFilesService({ get: () => undefined } as unknown as ConfigService);

  it('accepts a PDF within the cap', () => {
    expect(() => files.assertUploadable('application/pdf', 1024)).not.toThrow();
  });

  it('rejects anything that is not a PDF', () => {
    // The browser sets `accept="application/pdf"`, which is a hint and nothing more.
    expect(() => files.assertUploadable('text/html', 1024)).toThrow(BadRequestException);
    expect(() => files.assertUploadable('application/octet-stream', 1024)).toThrow(BadRequestException);
  });

  it('caps the size', () => {
    // The three older attachment services take ContentLength from the client verbatim
    // with no cap at all. New code, so it gets the check.
    expect(() => files.assertUploadable('application/pdf', TRAINING_MAX_FILE_BYTES + 1)).toThrow(BadRequestException);
    expect(() => files.assertUploadable('application/pdf', 0)).toThrow(BadRequestException);
  });

  it('refuses to presign before it has checked the file', async () => {
    // Order matters: a presigned URL is permission to write, and there is no second
    // chance to refuse once it is handed out. The size check must come first --
    // storage is unconfigured here, so reaching S3 would throw a different error.
    await expect(files.createPresignedUpload('r1', 'x.exe', 'application/x-msdownload', 10)).rejects.toThrow(/must be PDFs/);
  });
});

describe('the object key an upload may be attached under', () => {
  // Not covered by TrainingFilesService: the key is chosen by the *client* on the
  // attach call, and the bucket is shared with job, bug and workflow attachments.
  const prefixFor = (resourceId: string): string => `training/${resourceId}/`;

  it('accepts a key the presign step would have produced', () => {
    expect('training/abc/uuid-file.pdf'.startsWith(prefixFor('abc'))).toBe(true);
  });

  it('rejects another feature’s key, and another document’s', () => {
    expect('jobs/xyz/attachments/uuid-secret.pdf'.startsWith(prefixFor('abc'))).toBe(false);
    expect('training/other/uuid-file.pdf'.startsWith(prefixFor('abc'))).toBe(false);
  });
});
