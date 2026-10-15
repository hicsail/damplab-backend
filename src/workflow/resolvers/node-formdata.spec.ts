import mongoose from 'mongoose';
import { WorkflowNodeResolver } from './node.resolver';

/**
 * A stored file keeps its download link even after the catalog changes the parameter it answered: the node's own copy
 * of its parameters (saved with the job) says it was a file, so the link comes from there when the catalog no longer
 * does. Only a value with a storage key is ever given a link; anything else is handed back exactly as stored.
 */
const stored = JSON.stringify({ filename: 'samples.xlsx', key: 'workflow-parameters/u/samples.xlsx', contentType: 'application/vnd.ms-excel', size: 9 });

function resolverWith(catalogParameters: any[]): { resolver: WorkflowNodeResolver; createPresignedDownload: jest.Mock } {
  const createPresignedDownload = jest.fn(async (key: string) => `https://s3/${key}`);
  const resolver = new WorkflowNodeResolver(
    { findOne: async () => ({ _id: 'svc', name: 'Samples', parameters: catalogParameters }) } as any,
    {} as any,
    {} as any,
    {} as any,
    { createPresignedDownload } as any,
    {} as any,
    {} as any
  );
  return { resolver, createPresignedDownload };
}
const nodeOf = (formData: any[], nodeParameters: any[]): any => ({ service: { _id: 'svc', parameters: [] }, formData, reactNode: { data: { parameters: nodeParameters } } });
const asNode = (n: any): any => ({ ...n, service: new mongoose.Types.ObjectId() });

describe('WorkflowNodeResolver.formData — download links', () => {
  const sheet = { id: 'upload_samples', name: 'Upload Samples', type: 'sampleSheet' };

  it('links a stored file the catalog still lists as a file', async () => {
    const { resolver } = resolverWith([sheet]);
    const [entry] = await resolver.formData(asNode(nodeOf([{ id: 'upload_samples', value: stored }], [sheet])));
    expect(entry.value).toMatchObject({ filename: 'samples.xlsx', url: 'https://s3/workflow-parameters/u/samples.xlsx' });
  });

  it.each([
    ['removed from the operation', []],
    ['changed to another type', [{ id: 'upload_samples', name: 'Upload Samples', type: 'string' }]]
  ])('still links it when the catalog parameter was %s, from the node’s own copy', async (_label, catalog) => {
    const { resolver } = resolverWith(catalog);
    const [entry] = await resolver.formData(asNode(nodeOf([{ id: 'upload_samples', value: stored }], [sheet])));
    expect(entry.value).toMatchObject({ url: 'https://s3/workflow-parameters/u/samples.xlsx' });
  });

  it('hands back anything without a storage key exactly as stored, on a parameter only the node’s copy calls a file', async () => {
    const { resolver, createPresignedDownload } = resolverWith([{ id: 'upload_samples', name: 'Count', type: 'number' }]);
    const out = await resolver.formData(asNode(nodeOf([{ id: 'upload_samples', value: 3 }], [sheet])));
    expect(out[0].value).toBe(3);
    expect(createPresignedDownload).not.toHaveBeenCalled();
  });
});
