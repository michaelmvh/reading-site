import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import type { Article, Dataset, Shard, Snapshot } from "../src/data-model.ts";
import { sourceKey } from "../src/data-model.ts";

const schema: unknown = JSON.parse(await readFile(new URL("../schema/snapshot-v1.json", import.meta.url), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats.default(ajv);
if (!schema || typeof schema !== "object") throw new Error("Invalid checked-in snapshot schema");
ajv.addSchema(schema);
const base = "https://reading.michaelmvh.com/schema/snapshot-v1.json#/definitions/";
const validateSnapshot = ajv.compile<Snapshot>({ $ref: `${base}snapshot` });
const validateShard = ajv.compile<Shard>({ $ref: `${base}shard` });
export const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

async function bytes(file: string): Promise<Buffer> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`Expected an ordinary unlinked file: ${file}`);
  if (stat.size > 50 * 1024 * 1024) throw new Error(`Data file exceeds 50 MiB: ${file}`);
  return readFile(file);
}

export function validateArticleUrls(article: Article): void {
  const urls = [article.link, article.pdf_url, article.collection_date?.commit_url, ...article.discovery_sources.map((source) => source.url)];
  for (const value of urls) {
    if (!value) continue;
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Article URL contains an unsafe scheme or credentials");
  }
}

export async function loadData(root: string): Promise<Dataset> {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Data root must be a real directory");
  const entries = await readdir(root);
  if (entries.some((name) => !["snapshot.json", "articles"].includes(name))) throw new Error("Unexpected files in data/; only JSON snapshots belong here");
  const raw = await bytes(path.join(root, "snapshot.json"));
  const snapshot: unknown = JSON.parse(raw.toString("utf8"));
  if (!validateSnapshot(snapshot)) throw new Error(`Invalid snapshot: ${ajv.errorsText(validateSnapshot.errors)}`);
  const generated = Date.parse(snapshot.generated_at);
  if (!Number.isFinite(generated) || generated > Date.now() + 300_000) throw new Error("Data generation time is invalid or in the future");
  const dir = path.join(root, "articles");
  if (!(await lstat(dir)).isDirectory() || (await lstat(dir)).isSymbolicLink()) throw new Error("Article shards must be in a real directory");
  const expected = snapshot.article_files.map((file) => file.path);
  if (new Set(expected).size !== expected.length) throw new Error("Repeated article shard");
  const actual = (await readdir(dir)).map((name) => `articles/${name}`);
  if (actual.length !== expected.length || actual.some((name) => !expected.includes(name))) throw new Error("Missing or unexpected article shards");
  const articles = new Map<string, Article>();
  let total = raw.length;
  const identityOwners = new Map<string, string>();
  for (const entry of snapshot.article_files) {
    const content = await bytes(path.join(root, entry.path));
    total += content.length;
    if (total > 500 * 1024 * 1024) throw new Error("JSON snapshot exceeds 500 MiB");
    if (sha256(content) !== entry.sha256) throw new Error(`Article shard checksum mismatch: ${entry.path}`);
    const shard: unknown = JSON.parse(content.toString("utf8"));
    if (!validateShard(shard)) throw new Error(`Invalid article shard: ${ajv.errorsText(validateShard.errors)}`);
    if (shard.articles.length !== entry.count) throw new Error("Article shard count mismatch");
    for (const article of shard.articles) {
      if (entry.path !== `articles/${article.id.slice(0, 2)}.json` || articles.has(article.id)) throw new Error("Duplicate or misplaced article identity");
      validateArticleUrls(article);
      for (const key of article.identity_keys) {
        const owner = identityOwners.get(key);
        if (owner && owner !== article.id) throw new Error("One source identity belongs to multiple articles");
        identityOwners.set(key, article.id);
      }
      articles.set(article.id, article);
    }
  }
  for (const article of articles.values()) {
    if (article.canonical_id) {
      const target = articles.get(article.canonical_id);
      if (!target || target.canonical_id) throw new Error(`Article ${article.id}: canonical_id must reference an existing canonical article`);
    }
  }
  const feeds = snapshot.feeds.map((feed) => feed.id);
  if (new Set(feeds).size !== feeds.length || !feeds.includes(snapshot.default_feed)) throw new Error("Invalid default or duplicate feed");
  for (const feed of snapshot.feeds) {
    const collected = Date.parse(feed.collected_at);
    if (!Number.isFinite(collected) || collected > generated) throw new Error("Feed collection time is invalid or newer than the snapshot");
    const authors = feed.authors.map((author) => author.id);
    const sources = feed.sources.map((source) => source.value);
    if (new Set(authors).size !== authors.length || new Set(sources).size !== sources.length) throw new Error("Repeated filter options");
    if (Object.keys(feed.matches).length !== feed.article_ids.length) throw new Error("Feed author association coverage mismatch");
    for (const id of feed.article_ids) {
      const article = articles.get(id);
      if (!article || !Object.hasOwn(feed.matches, id)) throw new Error("Feed references a missing article or association");
      if (article.canonical_id) throw new Error("Feed references an article alias instead of its canonical article");
      if (feed.matches[id].some((author) => !authors.includes(author))) throw new Error("Feed references an unknown tracked author");
      if (!article.discovery_sources.some((source) => sources.includes(sourceKey(source)))) {
        throw new Error(
          `Feed ${JSON.stringify(feed.id)} article ${JSON.stringify(id)} has no matching collected source: ` +
          `article sources=${JSON.stringify(article.discovery_sources.map(sourceKey))}; ` +
          `selected sources=${JSON.stringify(sources)}; identities=${JSON.stringify(article.identity_keys)}`,
        );
      }
    }
  }
  return { snapshot, articles, digest: sha256(raw) };
}

export function validateTransition(current: Dataset, previous: Dataset, allowShrink: boolean): void {
  if (Date.parse(current.snapshot.generated_at) < Date.parse(previous.snapshot.generated_at)) throw new Error("Refusing an older snapshot");
  for (const [id, old] of previous.articles) {
    const retained = current.articles.get(id);
    if (!retained) throw new Error("Retained article disappeared; archive removal needs an explicit migration");
    const before = previous.articles.get(old.canonical_id ?? id)!;
    const after = current.articles.get(retained.canonical_id ?? id)!;
    if (before.identity_keys.some((key) => !after.identity_keys.includes(key))) {
      throw new Error(`Retained article ${id} lost source identities or points to an unrelated canonical article`);
    }
  }
  if (!allowShrink) {
    for (const old of previous.snapshot.feeds) {
      const next = current.snapshot.feeds.find((feed) => feed.id === old.id);
      if (!next || next.article_ids.length < old.article_ids.length * 0.6) throw new Error(`Feed ${old.id} disappeared or lost more than 40% of records`);
    }
  }
}
