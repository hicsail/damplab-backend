import { BadRequestException } from '@nestjs/common';
import { JOB_DESCRIPTION_MAX_LENGTH, normalizeJobDescription } from './job-description';

describe('normalizeJobDescription', () => {
  it('trims', () => {
    expect(normalizeJobDescription('  Plasmid prep for lab 4  ')).toBe('Plasmid prep for lab 4');
  });
  it('stores empty and whitespace-only as unset', () => {
    expect(normalizeJobDescription('')).toBeUndefined();
    expect(normalizeJobDescription('   ')).toBeUndefined();
    expect(normalizeJobDescription(null)).toBeUndefined();
    expect(normalizeJobDescription(undefined)).toBeUndefined();
  });
  it('accepts exactly 500 characters after trimming', () => {
    expect(normalizeJobDescription(` ${'x'.repeat(JOB_DESCRIPTION_MAX_LENGTH)} `)).toHaveLength(500);
  });
  it('rejects 501 characters', () => {
    expect(() => normalizeJobDescription('x'.repeat(501))).toThrow(BadRequestException);
  });
});
