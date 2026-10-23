import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Article, Snapshot } from "../src/data-model.ts";
import { sha256 } from "../scripts/data.ts";

export async function writeFixture(root: string, generatedAt = new Date().toISOString()): Promise<Snapshot> {
  const make = (key: string): Article => ({
    id: sha256(key), identity_keys: [key, `https://example.org/${key}`], title: `Paper <${key}> & research`,
    link: `https://example.org/${key}`, pdf_url: null, publication_date: "2026-10-01",
    publication_date_precision: "unknown", collection_date: null, venue: "Example Journal",
    authors: [{ key, name: key === "required" ? "Required Author" : "Optional Author" }],
    abstract_text: "Example abstract with <script>untrusted markup</script>.",
    discovery_sources: [{ kind: "open_alex", key: "openalex", label: "OpenAlex", url: "https://openalex.org" }],
    curated_categories: [],
  });
  const required = make("required");
  const optional = make("optional");
  optional.discovery_sources = [{ kind: "curated_collection", key: "example", label: "Example collection", url: "https://example.org/collection" }];
  const collection = make("collection");
  collection.authors = [{ key: "untracked", name: "Other Author" }];
  collection.publication_date = null;
  collection.collection_date = { date: "2026-10-01", commit_url: "https://example.org/commit" };
  const retained = make("retained");
  const snapshot: Snapshot = {
    schema_version: 1, generated_at: generatedAt, generator_version: "fixture",
    freshness_policy: "required_discovery_refresh", default_feed: "example",
    feeds: [{
      id: "example", title: "Research & Science", description: "Synthetic reader fixture",
      collected_at: generatedAt, article_ids: [required.id, optional.id, collection.id],
      authors: [{ id: "required", label: "Required Author", default_selected: true }, { id: "optional", label: "Optional Author", default_selected: false }],
      matches: { [required.id]: ["required"], [optional.id]: ["optional"], [collection.id]: [] },
      sources: [{ value: "core", label: "Tracked authors" }, { value: "curated:example", label: "Example collection" }],
    }], article_files: [],
  };
  const buckets = new Map<string, Article[]>();
  for (const article of [required, optional, collection, retained]) {
    const key = article.id.slice(0, 2);
    const articles = buckets.get(key) ?? [];
    articles.push(article); buckets.set(key, articles);
  }
  await mkdir(path.join(root, "articles"), { recursive: true });
  for (const [key, articles] of [...buckets.entries()].sort()) {
    const file = `articles/${key}.json`;
    const bytes = JSON.stringify({ schema_version: 1, articles }, null, 2) + "\n";
    await writeFile(path.join(root, file), bytes);
    snapshot.article_files.push({ path: file, count: articles.length, sha256: sha256(bytes) });
  }
  await writeFile(path.join(root, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("Provide a fixture destination");
  await writeFixture(process.argv[2]);
}
