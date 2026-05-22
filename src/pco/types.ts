// JSON:API envelope shapes used across Planning Center responses.

export interface JsonApiResource<TAttrs = Record<string, unknown>, TRel = Record<string, unknown>> {
  id: string;
  type: string;
  attributes: TAttrs;
  relationships?: TRel;
  links?: Record<string, string>;
}

export interface JsonApiCollection<
  TAttrs = Record<string, unknown>,
  TRel = Record<string, unknown>,
> {
  data: JsonApiResource<TAttrs, TRel>[];
  meta?: { total_count?: number; count?: number } & Record<string, unknown>;
  links?: { next?: string; prev?: string; self?: string };
  included?: JsonApiResource[];
}

export interface JsonApiSingle<TAttrs = Record<string, unknown>, TRel = Record<string, unknown>> {
  data: JsonApiResource<TAttrs, TRel>;
  included?: JsonApiResource[];
}

// PCO Services resource attribute shapes (subset — extended as tools land).

export interface ServiceTypeAttrs {
  name: string;
  sequence: number;
  permissions: string;
  created_at: string;
  updated_at: string;
}

export interface PlanAttrs {
  title: string | null;
  dates: string;
  sort_date: string;
  short_dates: string;
  planning_center_url: string;
  total_length: number;
  created_at: string;
  updated_at: string;
}

export interface PersonAttrs {
  first_name: string;
  last_name: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
}
