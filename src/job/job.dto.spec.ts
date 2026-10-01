import { BadRequestException } from '@nestjs/common';
import { CreateJobPipe } from './job.dto';

describe('CreateJobPipe', () => {
  const pipe = new CreateJobPipe({ transform: async (w: any) => w } as any);
  const base = { name: 'Job', institute: 'BU', workflows: [] } as any;

  it('trims the description and normalizes the client email', async () => {
    const out = await pipe.transform({ ...base, description: '  For lab 4  ', clientEmail: ' Client@BU.edu ' });
    expect(out.description).toBe('For lab 4');
    expect(out.clientEmail).toBe('client@bu.edu');
  });

  it('stores an empty description as unset', async () => {
    expect((await pipe.transform({ ...base, description: '   ' })).description).toBeUndefined();
  });

  it('rejects a description over 500 characters', async () => {
    await expect(pipe.transform({ ...base, description: 'x'.repeat(501) })).rejects.toBeInstanceOf(BadRequestException);
  });
});
