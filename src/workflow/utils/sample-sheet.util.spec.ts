import { JobState } from '../../job/job.model';
import { findSampleSheetParam, keyBelongsToUploader, sampleCountFromValue, sampleSheetReplaceBlockedReason, templateKeyOf } from './sample-sheet.util';

describe('sample-sheet.util', () => {
  describe('sampleCountFromValue', () => {
    it('reads the count off the stored JSON string and off a parsed object', () => {
      expect(sampleCountFromValue(JSON.stringify({ filename: 'a.xlsx', key: 'k', sampleCount: 12 }))).toBe(12);
      expect(sampleCountFromValue({ filename: 'a.xlsx', key: 'k', sampleCount: 0, url: 'u' })).toBe(0);
    });

    it('is undefined for no file, junk, or a count that is not a non-negative number', () => {
      expect(sampleCountFromValue(null)).toBeUndefined();
      expect(sampleCountFromValue('')).toBeUndefined();
      expect(sampleCountFromValue('nope')).toBeUndefined();
      expect(sampleCountFromValue({ filename: 'a.xlsx' })).toBeUndefined();
      expect(sampleCountFromValue({ filename: 'a.xlsx', sampleCount: '5' })).toBeUndefined();
      expect(sampleCountFromValue({ filename: 'a.xlsx', sampleCount: -1 })).toBeUndefined();
    });
  });

  describe('findSampleSheetParam', () => {
    const parameters = [
      { id: 'notes', type: 'string' },
      { id: 'samples', type: 'sampleSheet', templateFile: { key: 'sample-sheet-templates/abc-blank.xlsx' } },
      { id: 'other', type: 'file' }
    ];

    it('finds only a parameter of the sampleSheet type', () => {
      expect(findSampleSheetParam(parameters, 'samples')?.id).toBe('samples');
      expect(findSampleSheetParam(parameters, 'other')).toBeNull();
      expect(findSampleSheetParam(parameters, 'missing')).toBeNull();
    });

    it('tolerates parameters that are not an array', () => {
      expect(findSampleSheetParam(undefined, 'samples')).toBeNull();
      expect(findSampleSheetParam({ samples: {} }, 'samples')).toBeNull();
    });
  });

  describe('templateKeyOf', () => {
    it('returns the key only when it sits under the template prefix', () => {
      expect(templateKeyOf({ id: 'a', type: 'sampleSheet', templateFile: { key: 'sample-sheet-templates/x.xlsx' } })).toBe('sample-sheet-templates/x.xlsx');
      expect(templateKeyOf({ id: 'a', type: 'sampleSheet', templateFile: { key: 'workflow-parameters/u/x.xlsx' } })).toBeNull();
      expect(templateKeyOf({ id: 'a', type: 'sampleSheet' })).toBeNull();
      expect(templateKeyOf(null)).toBeNull();
    });
  });

  describe('keyBelongsToUploader', () => {
    it('accepts a key under the caller’s own upload prefix and nothing else', () => {
      expect(keyBelongsToUploader('workflow-parameters/user-1/abc-samples.xlsx', 'user-1')).toBe(true);
      expect(keyBelongsToUploader('workflow-parameters/user-2/abc-samples.xlsx', 'user-1')).toBe(false);
      expect(keyBelongsToUploader('workflow-parameters/user-1/../user-2/abc.xlsx', 'user-1')).toBe(false);
      expect(keyBelongsToUploader('sample-sheet-templates/abc.xlsx', 'user-1')).toBe(false);
      expect(keyBelongsToUploader('workflow-parameters/user-10/abc.xlsx', 'user-1')).toBe(false);
    });
  });

  describe('sampleSheetReplaceBlockedReason', () => {
    it('allows replacement in every state the job is still alive in', () => {
      for (const state of [JobState.CREATING, JobState.SUBMITTED, JobState.CHANGES_REQUESTED, JobState.ACCEPTED, JobState.WAITING_FOR_SOW, JobState.QUEUED, JobState.IN_PROGRESS, JobState.COMPLETE]) {
        expect(sampleSheetReplaceBlockedReason({ state })).toBeNull();
      }
    });

    it('refuses once the job is finished with', () => {
      expect(sampleSheetReplaceBlockedReason({ state: JobState.CLOSED })).toMatch(/closed/);
      expect(sampleSheetReplaceBlockedReason({ state: JobState.CANCELLED })).toMatch(/cancelled/);
      expect(sampleSheetReplaceBlockedReason({ state: JobState.REJECTED })).toMatch(/not accepted/);
    });
  });
});
