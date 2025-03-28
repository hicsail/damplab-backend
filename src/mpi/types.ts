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

export interface HazardHits {
  type: 'nuc' | 'aa';
  is_wild_type: boolean | null;
  hit_regions: HitRegion[];
  most_likely_organism: Organism;
  organisms: Organism[];
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

export interface ScreeningResult {
  sequenceId: string;
  sequence: {
    id: string;
    name: string;
  };
  status: 'granted' | 'denied';
  threats: HazardHits[];
  region: string;
  createdAt: Date;
  warning?: string;
  originalSeq: string;
}
