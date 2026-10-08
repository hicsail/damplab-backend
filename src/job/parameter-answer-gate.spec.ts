import { BadRequestException } from '@nestjs/common';
import { assertParameterAnswersValid, parameterAnswerProblems } from './parameter-answer-gate';

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
