// Song-specific attribute shapes for Planning Center Services API.

export interface SongAttrs {
  title: string;
  author: string | null;
  ccli_number: string | null;
  themes: string | null;
  admin: string;
  created_at: string;
  updated_at: string;
}

export interface ArrangementAttrs {
  name: string;
  bpm: number | null;
  length: number;
  chord_chart_key: string | null;
  created_at: string;
  updated_at: string;
}