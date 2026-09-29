import { BadRequestException } from '@nestjs/common';

export const JOB_DESCRIPTION_MAX_LENGTH = 500;

/** Trimmed; empty means unset; longer than 500 is refused rather than truncated. */
export function normalizeJobDescription(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > JOB_DESCRIPTION_MAX_LENGTH) {
    throw new BadRequestException(`The description can be at most ${JOB_DESCRIPTION_MAX_LENGTH} characters.`);
  }
  return trimmed;
}
