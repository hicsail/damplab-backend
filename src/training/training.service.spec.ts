import { slugify } from './training.service';
import { SEED_GUIDES } from './seed-guides';

describe('slugify — the URL segment a guide is reachable at', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Designing Jobs on the Canvas')).toBe('designing-jobs-on-the-canvas');
  });

  it('drops punctuation rather than encoding it into the URL', () => {
    expect(slugify('Services, categories & bundles!')).toBe('services-categories-bundles');
  });

  it('collapses runs of whitespace, underscores and hyphens', () => {
    expect(slugify('  a   b__c--d  ')).toBe('a-b-c-d');
  });

  it('bounds the length, so a long title cannot produce an unusable URL', () => {
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it('returns empty for a title with nothing usable in it — the service rejects that', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('SEED_GUIDES — the two hardcoded pages, ported', () => {
  it('carries both guides with distinct slugs', () => {
    expect(SEED_GUIDES).toHaveLength(2);
    expect(new Set(SEED_GUIDES.map((g) => g.slug)).size).toBe(2);
  });

  it('gives every guide a slug that survives its own slugify', () => {
    // Seeding runs slugify over the given slug, so a seed whose slug is not already
    // canonical would be stored under a different URL than the one written here.
    for (const guide of SEED_GUIDES) {
      expect(slugify(guide.slug!)).toBe(guide.slug);
    }
  });

  it('publishes them — they are replacing pages that were already live', () => {
    for (const guide of SEED_GUIDES) {
      expect(guide.isPublished).toBe(true);
      expect(guide.body!.length).toBeGreaterThan(500);
    }
  });
});
