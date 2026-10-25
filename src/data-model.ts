export interface Source {
  kind: "open_alex" | "google_scholar" | "biorxiv" | "arxiv" | "curated_collection";
  key: string;
  label: string;
  url: string | null;
}

export interface Article {
  id: string;
  canonical_id?: string;
  identity_keys: string[];
  title: string;
  link: string | null;
  pdf_url: string | null;
  publication_date: string | null;
  publication_date_precision: "day" | "month" | "year" | "unknown";
  collection_date: { date: string; commit_url: string } | null;
  venue: string | null;
  authors: { key: string; name: string }[];
  abstract_text: string | null;
  discovery_sources: Source[];
  curated_categories: string[];
}

export interface Feed {
  id: string;
  title: string;
  description: string;
  collected_at: string;
  article_ids: string[];
  authors: { id: string; label: string; default_selected: boolean }[];
  matches: Record<string, string[]>;
  sources: { value: string; label: string }[];
}

export interface Snapshot {
  schema_version: 1;
  generated_at: string;
  generator_version: string;
  freshness_policy: "required_discovery_refresh";
  default_feed: string;
  feeds: Feed[];
  article_files: { path: string; sha256: string; count: number }[];
}

export interface Shard {
  schema_version: 1;
  articles: Article[];
}

export interface Dataset {
  snapshot: Snapshot;
  articles: Map<string, Article>;
  digest: string;
}

export function sourceKey(source: Source): string {
  if (source.kind === "open_alex" || source.kind === "google_scholar") return "core";
  return source.kind === "curated_collection" ? `curated:${source.key}` : source.key;
}
