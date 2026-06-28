export const MEMORY_TYPES = [
  'rules',
  'architecture',
  'deploy',
  'decision',
  'preference',
  'note',
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface Memory {
  id: number;
  repo: string;
  type: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface MemoryWithScore extends Memory {
  score: number;
}
