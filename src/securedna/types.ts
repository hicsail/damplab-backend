import type { Sequence, SecureDnaHazardHit, ScreeningBatch } from './models/securedna-graphql.model';

export type { Sequence, SecureDnaHazardHit, ScreeningBatch };
export { Region } from './region';

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
  hits_by_hazard: SecureDnaHazardHit[];
}

export interface ScreeningResponse {
  synthesis_permission: 'granted' | 'denied';
  provider_reference?: string;
  hits_by_record?: RecordHit[];
}
