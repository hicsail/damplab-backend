import { BadRequestException } from '@nestjs/common';
import { assertChangedAnswersValid, assertParameterAnswersValid, changedAnswerIds, changedAnswerProblems, parameterAnswerProblems } from './parameter-answer-gate';

const pcr = {
  _id: 'svc1',
  name: 'PCR',
  parameters: [
    { id: 'cycles', name: 'Cycles', type: 'number', validation: '>0 && <100 && integer' },
    { id: 'vol', name: 'Volume', type: 'number', rangeValueMin: 1, rangeValueMax: 50 },
    { id: 'notes', name: 'Notes', type: 'string' },
    {
      id: 'sample_type',
      name: 'Sample Type',
      type: 'dropdown',
      options: [
        { id: 'bact', name: 'Bacteria' },
        { id: 'oth', name: 'Other' }
      ]
    }
  ]
};
const job = (formData: any): any[] => [{ nodes: [{ service: pcr, formData }] }];

describe('createJob answer gate (rules 26, 29)', () => {
  it('passes a job whose numbers obey their rules', () => {
    expect(
      parameterAnswerProblems(
        job([
          { id: 'cycles', value: 30 },
          { id: 'vol', value: '25' }
        ])
      )
    ).toEqual([]);
  });

  it('names the parameter, the operation and the broken rule', () => {
    expect(parameterAnswerProblems(job([{ id: 'cycles', value: 0 }]))).toEqual(['“Cycles” on “PCR”: Must be greater than 0']);
    expect(parameterAnswerProblems(job([{ id: 'cycles', value: 2.5 }]))).toEqual(['“Cycles” on “PCR”: Must be a whole number']);
  });

  it('enforces a stored min/max that has no validation string (rule 24)', () => {
    expect(parameterAnswerProblems(job([{ id: 'vol', value: 51 }]))).toEqual(['“Volume” on “PCR”: Must be at most 50']);
    expect(parameterAnswerProblems(job([{ id: 'vol', value: 0 }]))).toEqual(['“Volume” on “PCR”: Must be at least 1']);
  });

  it('ignores an empty number — "required" is not this gate', () => {
    expect(
      parameterAnswerProblems(
        job([
          { id: 'cycles', value: '' },
          { id: 'vol', value: null }
        ])
      )
    ).toEqual([]);
    expect(parameterAnswerProblems(job([]))).toEqual([]);
  });

  it('checks each value of a multi-value number', () => {
    expect(parameterAnswerProblems(job([{ id: 'cycles', value: [5, 0] }]))).toEqual(['“Cycles” on “PCR”: Must be greater than 0']);
  });

  it('refuses "Other" with blank text, and accepts it with text', () => {
    expect(parameterAnswerProblems(job([{ id: 'sample_type', value: 'oth' }]))).toEqual(['“Sample Type” on “PCR”: Please specify “Other”.']);
    expect(
      parameterAnswerProblems(
        job([
          { id: 'sample_type', value: 'oth' },
          { id: 'sample_type__otherText', value: '   ' }
        ])
      )
    ).toEqual(['“Sample Type” on “PCR”: Please specify “Other”.']);
    expect(
      parameterAnswerProblems(
        job([
          { id: 'sample_type', value: 'oth' },
          { id: 'sample_type__otherText', value: 'Yeast' }
        ])
      )
    ).toEqual([]);
    expect(parameterAnswerProblems(job([{ id: 'sample_type', value: 'bact' }]))).toEqual([]);
  });

  it('reads formData keyed by id as well as the canonical array', () => {
    expect(parameterAnswerProblems(job({ cycles: 0 }))).toEqual(['“Cycles” on “PCR”: Must be greater than 0']);
  });

  it('resolves a node that carries only a service id through the services list', () => {
    const workflows: any[] = [{ nodes: [{ serviceId: 'svc1', formData: [{ id: 'cycles', value: 0 }] }] }];
    expect(parameterAnswerProblems(workflows, [pcr])).toEqual(['“Cycles” on “PCR”: Must be greater than 0']);
    expect(parameterAnswerProblems(workflows)).toEqual([]);
  });

  it('throws the first problem as a BadRequestException, and nothing when there is none', () => {
    expect(() =>
      assertParameterAnswersValid(
        job([
          { id: 'cycles', value: 0 },
          { id: 'vol', value: 99 }
        ])
      )
    ).toThrow(BadRequestException);
    expect(() =>
      assertParameterAnswersValid(
        job([
          { id: 'cycles', value: 0 },
          { id: 'vol', value: 99 }
        ])
      )
    ).toThrow('“Cycles” on “PCR”: Must be greater than 0');
    expect(() => assertParameterAnswersValid(job([{ id: 'cycles', value: 3 }]))).not.toThrow();
    expect(() => assertParameterAnswersValid(undefined)).not.toThrow();
  });
});

describe('answers a save changes (rule 26 on a customer resubmission)', () => {
  const node = (before: any, after: any): any => ({ service: pcr, before, after });

  it('names only the ids whose value differs', () => {
    expect([
      ...changedAnswerIds(
        [
          { id: 'cycles', value: 30 },
          { id: 'vol', value: 99 },
          { id: 'notes', value: 'a' }
        ],
        [
          { id: 'cycles', value: '30' },
          { id: 'vol', value: 99 },
          { id: 'notes', value: 'b' }
        ]
      )
    ]).toEqual(['notes']);
  });

  it('does not count an id that is empty on the side where it is missing', () => {
    expect([
      ...changedAnswerIds(
        [{ id: 'vol', value: 5 }],
        [
          { id: 'vol', value: 5 },
          { id: 'cycles', value: '' }
        ]
      )
    ]).toEqual([]);
    expect([
      ...changedAnswerIds(
        [
          { id: 'vol', value: 5 },
          { id: 'notes', value: null }
        ],
        [{ id: 'vol', value: 5 }]
      )
    ]).toEqual([]);
  });

  it('counts a value that was removed, and reads stored formData keyed by id', () => {
    expect([...changedAnswerIds({ vol: 5, notes: 'a' }, [{ id: 'vol', value: 6 }])].sort()).toEqual(['notes', 'vol']);
  });

  it('refuses a number the save changed to a value that breaks its rule', () => {
    expect(changedAnswerProblems([node([{ id: 'cycles', value: 30 }], [{ id: 'cycles', value: 0 }])])).toEqual(['“Cycles” on “PCR”: Must be greater than 0']);
  });

  it('leaves alone a stored answer the save did not touch, even one that breaks its rule', () => {
    expect(
      changedAnswerProblems([
        node(
          [
            { id: 'vol', value: 99 },
            { id: 'notes', value: 'a' }
          ],
          [
            { id: 'vol', value: '99' },
            { id: 'notes', value: 'b' }
          ]
        )
      ])
    ).toEqual([]);
  });

  it('leaves alone an untouched "Other" that was stored without text', () => {
    expect(
      changedAnswerProblems([
        node(
          [
            { id: 'sample_type', value: 'oth' },
            { id: 'notes', value: 'a' }
          ],
          [
            { id: 'sample_type', value: 'oth' },
            { id: 'notes', value: 'b' }
          ]
        )
      ])
    ).toEqual([]);
  });

  it('checks "Other" when only its text changed', () => {
    const before = [
      { id: 'sample_type', value: 'oth' },
      { id: 'sample_type__otherText', value: 'Yeast' }
    ];
    expect(
      changedAnswerProblems([
        node(before, [
          { id: 'sample_type', value: 'oth' },
          { id: 'sample_type__otherText', value: '  ' }
        ])
      ])
    ).toEqual(['“Sample Type” on “PCR”: Please specify “Other”.']);
    expect(changedAnswerProblems([node(before, [{ id: 'sample_type', value: 'oth' }])])).toEqual(['“Sample Type” on “PCR”: Please specify “Other”.']);
    expect(
      changedAnswerProblems([
        node(before, [
          { id: 'sample_type', value: 'oth' },
          { id: 'sample_type__otherText', value: 'Algae' }
        ])
      ])
    ).toEqual([]);
  });

  it('checks every answer on a node with nothing stored — a node the save adds', () => {
    expect(
      changedAnswerProblems([
        node(undefined, [
          { id: 'cycles', value: 0 },
          { id: 'vol', value: 99 }
        ])
      ])
    ).toEqual(['“Cycles” on “PCR”: Must be greater than 0', '“Volume” on “PCR”: Must be at most 50']);
  });

  it('throws the first problem as a BadRequestException, and nothing when there is none', () => {
    expect(() => assertChangedAnswersValid([node([{ id: 'cycles', value: 30 }], [{ id: 'cycles', value: 0 }])])).toThrow(BadRequestException);
    expect(() => assertChangedAnswersValid([node([{ id: 'cycles', value: 30 }], [{ id: 'cycles', value: 0 }])])).toThrow('“Cycles” on “PCR”: Must be greater than 0');
    expect(() => assertChangedAnswersValid([node([{ id: 'cycles', value: 0 }], [{ id: 'cycles', value: 0 }])])).not.toThrow();
    expect(() => assertChangedAnswersValid([])).not.toThrow();
  });
});

describe('hidden parameters are not checked (show-only-if rule 18)', () => {
  const kind = {
    id: 'kind',
    name: 'Kind',
    type: 'dropdown',
    options: [
      { id: 'rna', name: 'RNA' },
      { id: 'dna', name: 'DNA' }
    ]
  };
  const isRna = { parameterId: 'kind', op: 'eq', optionIds: ['rna'] };
  const extraction = {
    name: 'Extraction',
    parameters: [
      kind,
      { id: 'cycles', name: 'Cycles', type: 'number', validation: '>0', showIf: isRna },
      {
        id: 'method',
        name: 'Method',
        type: 'dropdown',
        showIf: isRna,
        options: [
          { id: 'col', name: 'Column' },
          { id: 'oth', name: 'Other' }
        ]
      }
    ]
  };
  const answers = (kindValue: string): any[] => [
    { id: 'kind', value: kindValue },
    { id: 'cycles', value: 0 },
    { id: 'method', value: 'oth' }
  ];
  const submitted = (kindValue: string): any[] => [{ nodes: [{ service: extraction, formData: answers(kindValue) }] }];

  it('createJob: checks a conditional parameter while it is shown', () => {
    expect(parameterAnswerProblems(submitted('rna'))).toEqual(['“Cycles” on “Extraction”: Must be greater than 0', '“Method” on “Extraction”: Please specify “Other”.']);
  });

  it('createJob: raises nothing for a hidden parameter, whatever was sent for it', () => {
    expect(parameterAnswerProblems(submitted('dna'))).toEqual([]);
    expect(() => assertParameterAnswersValid(submitted('dna'))).not.toThrow();
  });

  it('a customer save: an answer the save changes is not checked while its parameter is hidden', () => {
    const before = [
      { id: 'kind', value: 'dna' },
      { id: 'cycles', value: 5 }
    ];
    expect(changedAnswerProblems([{ service: extraction, before, after: answers('dna') }])).toEqual([]);
  });

  it('a customer save: visibility is decided against the whole list, not only the changed parameters', () => {
    // Only `cycles` changes; its controller `kind` does not. Checked against the changed subset alone,
    // the condition would not resolve and the hidden parameter would be checked.
    const before = [
      { id: 'kind', value: 'dna' },
      { id: 'cycles', value: 5 },
      { id: 'method', value: 'oth' }
    ];
    expect(changedAnswerProblems([{ service: extraction, before, after: answers('dna') }])).toEqual([]);
    const shownBefore = [{ id: 'kind', value: 'rna' }, ...before.slice(1)];
    expect(changedAnswerProblems([{ service: extraction, before: shownBefore, after: answers('rna') }])).toEqual(['“Cycles” on “Extraction”: Must be greater than 0']);
  });
});
