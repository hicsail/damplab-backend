import { buildParameterSnapshot } from './parameter-snapshot.util';

const service = {
  parameters: [
    { id: 'vol', name: 'Volume', type: 'number' },
    {
      id: 'enzyme',
      name: 'Enzyme',
      type: 'dropdown',
      options: [
        { id: 'e1', name: 'BsaI' },
        { id: 'e2', name: 'BsmBI' }
      ]
    },
    { id: 'kind', name: 'Kind', type: 'enum', options: [{ id: 'k1', name: 'Plasmid' }] },
    { id: 'sheet', name: 'Samples', type: 'sampleSheet' },
    { id: 'map', name: 'Plasmid map', type: 'file' },
    { id: 'blank', name: '  ', type: 'text' },
    { id: 'flag', name: 'Sterile', type: 'boolean' }
  ]
};

describe('buildParameterSnapshot', () => {
  it('names each saved value from the service and formats by type', () => {
    const snapshot = buildParameterSnapshot(service, [
      { id: 'vol', value: 10 },
      { id: 'enzyme', value: ['e1', 'e2'] },
      { id: 'kind', value: 'k1' },
      { id: 'sheet', value: JSON.stringify({ filename: 'samples.xlsx', key: 'workflow-parameters/u/1', sampleCount: 3 }) },
      { id: 'map', value: { filename: 'pUC19.gb', key: 'k', url: 'https://x' } },
      { id: 'blank', value: 'x' },
      { id: 'flag', value: false }
    ]);
    expect(snapshot).toEqual([
      { id: 'vol', name: 'Volume', type: 'number', displayValue: '10' },
      { id: 'enzyme', name: 'Enzyme', type: 'dropdown', displayValue: 'BsaI, BsmBI' },
      { id: 'kind', name: 'Kind', type: 'enum', displayValue: 'Plasmid' },
      { id: 'sheet', name: 'Samples', type: 'sampleSheet', displayValue: 'samples.xlsx' },
      { id: 'map', name: 'Plasmid map', type: 'file', displayValue: 'pUC19.gb' },
      { id: 'blank', name: 'blank', type: 'text', displayValue: 'x' },
      { id: 'flag', name: 'Sterile', type: 'boolean', displayValue: 'false' }
    ]);
  });

  it('shows only the filename for a bare S3 key, never the key', () => {
    const snapshot = buildParameterSnapshot(service, [{ id: 'map', value: 'workflow-parameters/user-1/plasmid.gb' }]);
    expect(snapshot[0].displayValue).toBe('plasmid.gb');
  });

  it('skips empty values', () => {
    expect(
      buildParameterSnapshot(service, [
        { id: 'vol', value: null },
        { id: 'enzyme', value: [] },
        { id: 'kind', value: '' }
      ])
    ).toEqual([]);
  });

  it('falls back to the option id when the option is gone', () => {
    expect(buildParameterSnapshot(service, [{ id: 'enzyme', value: 'e9' }])[0].displayValue).toBe('e9');
  });

  it('names reserved ids the UI injects, which are never in service.parameters', () => {
    const snapshot = buildParameterSnapshot(service, [
      { id: '__runCount', value: 2 },
      { id: '__equipBookers', value: ['a@x.org', 'b@x.org'] }
    ]);
    expect(snapshot).toEqual([
      { id: '__runCount', name: 'Number of runs', type: undefined, displayValue: '2' },
      { id: '__equipBookers', name: 'Authorized booker emails', type: undefined, displayValue: 'a@x.org, b@x.org' }
    ]);
  });

  it('carries a previous entry forward for an id the service no longer has', () => {
    const previous = [{ id: 'gone', name: 'Old parameter', type: 'text', displayValue: 'kept' }];
    expect(buildParameterSnapshot(service, [{ id: 'gone', value: 'kept' }], previous)).toEqual(previous);
  });

  it('uses the bare id when nothing names it', () => {
    expect(buildParameterSnapshot(service, [{ id: 'mystery', value: 'x' }])).toEqual([{ id: 'mystery', name: 'mystery', type: undefined, displayValue: 'x' }]);
  });

  it('accepts legacy object-shaped formData and a missing service', () => {
    expect(buildParameterSnapshot(null, { vol: 5 })).toEqual([{ id: 'vol', name: 'vol', type: undefined, displayValue: '5' }]);
  });
});

describe('buildParameterSnapshot — "Other" (rule 28)', () => {
  const withOther = {
    parameters: [
      {
        id: 'sample_type',
        name: 'Sample Type',
        type: 'dropdown',
        allowMultipleValues: true,
        options: [
          { id: 'bact', name: 'Bacteria' },
          { id: 'oth', name: 'Other' }
        ]
      }
    ]
  };

  it('reads "Other: <text>" and does not list the companion entry as its own parameter', () => {
    const snapshot = buildParameterSnapshot(withOther, [
      { id: 'sample_type', value: ['bact', 'oth'] },
      { id: 'sample_type__otherText', value: ' Yeast ' }
    ]);
    expect(snapshot).toEqual([{ id: 'sample_type', name: 'Sample Type', type: 'dropdown', displayValue: 'Bacteria, Other: Yeast' }]);
  });

  it('reads plain "Other" when no text was saved', () => {
    const snapshot = buildParameterSnapshot(withOther, [{ id: 'sample_type', value: ['oth'] }]);
    expect(snapshot).toEqual([{ id: 'sample_type', name: 'Sample Type', type: 'dropdown', displayValue: 'Other' }]);
  });

  it('still lists an entry that merely ends in the suffix when no parameter owns it', () => {
    const snapshot = buildParameterSnapshot({ parameters: [] }, [{ id: 'gone__otherText', value: 'x' }]);
    expect(snapshot).toEqual([{ id: 'gone__otherText', name: 'gone__otherText', type: undefined, displayValue: 'x' }]);
  });
});
