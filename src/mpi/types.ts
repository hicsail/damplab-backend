export interface Sequence {
  name: string;
  type: 'dna' | 'rna' | 'aa' | 'unknown';
  seq: string;
  annotations: {
    name: string;
    start: number;
    end: number;
    direction?: number;
    color?: string;
    type?: string;
  }[];
}

export type eLabsStatus = 'PENDING' | 'PROGRESS' | 'COMPLETED';

export interface BiosecurityResponse {
  status: 'granted' | 'denied';
  sequence?: string;
  biosecurityCheck?: {
    organism: {
      name: string;
      organism_type: string;
      tags: string[];
    };
    hit_regions: {
      start_index: number;
      end_index: number;
      seq: string;
    }[];
  }[];
}

export interface AclidSequence {
  name: string;
  sequence: string;
}

export interface ScreenSequencesDTO {
  submissionName: string;
  sequences: AclidSequence[];
}
