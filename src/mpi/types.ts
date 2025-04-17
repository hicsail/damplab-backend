import { Sequence, ScreeningResult, HazardHits } from './models/mpi.model';

export type { Sequence, ScreeningResult, HazardHits };

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

export enum Region {
  ALL = 'all',
  US = 'us',
  EU = 'eu',
  PRC = 'prc'
}

export interface ScreeningInput {
  sequenceId: string;
  region: Region;
  provider_reference?: string;
}

export interface HitRegion {
  seq: string;
  seq_range_start: number;
  seq_range_end: number;
}

export interface Organism {
  name: string;
  organism_type: 'Virus' | 'Toxin' | 'Bacterium' | 'Fungus';
  ans: string[];
  tags: string[];
}

export interface RecordHit {
  fasta_header: string;
  line_number_range: number[];
  sequence_length: number;
  hits_by_hazard: HazardHits[];
}

export interface ScreeningResponse {
  synthesis_permission: 'granted' | 'denied';
  provider_reference?: string;
  hits_by_record?: RecordHit[];
}

// Extend the Sequence type from mpi.model.ts
declare module './models/mpi.model' {
  interface Sequence {
    _id?: string;
    mpiId: string;
  }
}
