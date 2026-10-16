import { lstat, readFile, readdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_BYTES = 500 * 1024 * 1024;
const name = "[a-z0-9][a-z0-9-]{0,79}";
const allowed = new RegExp(`^(?:index\\.html|404\\.html|feed\\.xml|reader\\.css|static-(?:reader|model)\\.mjs|favicon\\.svg|apple-touch-icon\\.png|status\\.json|data/(?:archive|${name})\\.json|feeds/${name}/(?:index\\.html|feed\\.xml)|article/[a-f0-9]{64}/index\\.html)$`);
type ObjectValue = Record<string, unknown>;

function object(value: unknown, label: string): ObjectValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as ObjectValue;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a nonempty string`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function exactKeys(value: ObjectValue, keys: string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error(`Unexpected fields in ${label}`);
}

function validateArticle(value: unknown): ObjectValue {
  const article = object(value, "article");
  exactKeys(article, ["id", "feed", "keys", "publication"], "article");
  if (!/^[a-f0-9]{64}$/.test(string(article.id, "article ID"))) throw new Error("Invalid article identity");
  for (const key of array(article.keys, "identity keys")) string(key, "identity key");
  const publication = object(article.publication, "publication");
  exactKeys(publication, ["id", "title", "link", "pdf_url", "publication_date", "collection_date", "venue", "authors", "abstract_text", "discovery_sources", "curated_categories"], "publication");
  string(publication.title, "publication title");
  for (const field of ["id", "link", "pdf_url", "publication_date", "venue", "abstract_text"]) {
    if (publication[field] !== null && typeof publication[field] !== "string") throw new Error(`Invalid publication ${field}`);
  }
  for (const entry of array(publication.authors, "authors")) {
    const author = object(entry, "author");
    exactKeys(author, ["name", "filter_id", "matched_feed", "optional"], "author");
    string(author.name, "author name");
    if (typeof author.filter_id !== "string" || typeof author.matched_feed !== "boolean" || typeof author.optional !== "boolean") throw new Error("Invalid author metadata");
  }
  for (const entry of array(publication.discovery_sources, "sources")) {
    const source = object(entry, "source");
    exactKeys(source, ["kind", "key", "label", "url"], "source");
    string(source.kind, "source kind");
    string(source.key, "source key");
    string(source.label, "source label");
  }
  if (publication.collection_date !== null) {
    const date = object(publication.collection_date, "collection date");
    exactKeys(date, ["date", "commit_url"], "collection date");
    string(date.date, "collection date");
    string(date.commit_url, "collection commit");
  }
  for (const category of array(publication.curated_categories, "categories")) string(category, "category");
  return article;
}

async function readJson(file: string): Promise<ObjectValue> {
  return object(JSON.parse(await readFile(file, "utf8")) as unknown, file);
}

export function validateCounts(current: ObjectValue, previous: ObjectValue, allowShrink: boolean): void {
  for (const [feed, oldCount] of Object.entries(previous)) {
    const next = current[feed];
    if (!allowShrink && (typeof next !== "number" || (typeof oldCount === "number" && next < oldCount * 0.6))) {
      throw new Error(`Feed ${feed} disappeared or lost more than 40% of records; investigate or explicitly approve shrinkage`);
    }
  }
}

async function inventory(root: string, prefix = ""): Promise<Map<string, number>> {
  const files = new Map<string, number>();
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const metadata = await lstat(path.join(root, relative));
    if (metadata.isSymbolicLink() || metadata.nlink > 1 && metadata.isFile()) throw new Error(`Links are not allowed: ${relative}`);
    if (entry.isDirectory()) {
      if (!/^(data|feeds|article)(\/[a-z0-9-]+)?$/.test(relative)) throw new Error(`Unexpected directory: ${relative}`);
      for (const item of await inventory(root, relative)) files.set(...item);
    } else if (entry.isFile() && allowed.test(relative)) {
      if (!metadata.size) throw new Error(`Empty file: ${relative}`);
      files.set(relative, metadata.size);
    } else {
      throw new Error(`Unexpected output file: ${relative}`);
    }
  }
  return files;
}

function channelFrom(xml: string): ObjectValue {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("RSS must not declare external entities");
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid RSS XML");
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(xml);
  const rss = object(object(parsed, "XML").rss, "RSS");
  return object(rss.channel, "RSS channel");
}

export async function validateSite(root: string, previous?: string, allowShrink = false): Promise<void> {
  const files = await inventory(root);
  if ([...files.values()].reduce((sum, size) => sum + size, 0) > MAX_BYTES) throw new Error("Site exceeds the 500 MiB publication budget");
  const requireFile = (file: string) => { if (!files.has(file)) throw new Error(`Missing generated file: ${file}`); };
  for (const file of ["index.html", "404.html", "feed.xml", "reader.css", "static-reader.mjs", "static-model.mjs", "favicon.svg", "apple-touch-icon.png", "status.json", "data/archive.json"]) requireFile(file);
  const status = await readJson(path.join(root, "status.json"));
  exactKeys(status, ["schema_version", "generated_at", "generator_version", "feeds", "source_freshness"], "status");
  if (status.schema_version !== 1) throw new Error("Unsupported status schema");
  string(status.generator_version, "generator version");
  string(status.source_freshness, "source freshness");
  const generated = Date.parse(string(status.generated_at, "generation time"));
  if (!Number.isFinite(generated) || generated > Date.now() + 300_000) throw new Error("Invalid/future generation time");
  const counts = object(status.feeds, "feed counts");
  if (!Object.keys(counts).length) throw new Error("No generated feeds");
  if (previous) {
    const old = await readJson(path.join(previous, "status.json"));
    validateCounts(counts, object(old.feeds, "previous feed counts"), allowShrink);
    if (generated < Date.parse(string(old.generated_at, "previous generation time"))) throw new Error("Refusing an older snapshot");
  }
  const defaultChannel = channelFrom(await readFile(path.join(root, "feed.xml"), "utf8"));
  const defaultLink = new URL(string(defaultChannel.link, "default channel link"));
  if (!/^https?:$/.test(defaultLink.protocol) || defaultLink.username || defaultLink.password) throw new Error("Invalid channel origin");
  const feedSuffix = new RegExp(`/feeds/(${name})/$`);
  const suffix = defaultLink.pathname.match(feedSuffix);
  if (!suffix || !(suffix[1] in counts)) throw new Error("Default RSS must reference a named feed");
  const base = defaultLink.pathname.slice(0, -suffix[0].length) + "/";
  const archive = await readJson(path.join(root, "data/archive.json"));
  exactKeys(archive, ["schema_version", "articles"], "archive");
  if (archive.schema_version !== 1) throw new Error("Unsupported archive schema");
  const articles = object(archive.articles, "archived articles");
  for (const [id, value] of Object.entries(articles)) {
    const article = validateArticle(value);
    if (!/^[a-f0-9]{64}$/.test(id) || article.id !== id) throw new Error("Invalid article identity");
    if (!(string(article.feed, "article feed") in counts)) throw new Error("Unknown article feed");
    requireFile(`article/${id}/index.html`);
  }
  for (const [feed, count] of Object.entries(counts)) {
    if (!new RegExp(`^${name}$`).test(feed) || typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) throw new Error("Invalid feed name or count");
    requireFile(`feeds/${feed}/index.html`);
    requireFile(`feeds/${feed}/feed.xml`);
    requireFile(`data/${feed}.json`);
    const document = await readJson(path.join(root, `data/${feed}.json`));
    exactKeys(document, ["schema_version", "name", "title", "description", "generated_at", "sources", "articles"], "feed");
    if (document.schema_version !== 1 || document.name !== feed || array(document.articles, "feed articles").length !== count) throw new Error("Feed metadata/count mismatch");
    for (const value of array(document.sources, "feed sources")) {
      const source = object(value, "feed source");
      exactKeys(source, ["value", "label"], "feed source");
      string(source.value, "source value");
      string(source.label, "source label");
    }
    const ids = array(document.articles, "feed articles").map((value) => string(validateArticle(value).id, "article ID"));
    if (new Set(ids).size !== ids.length || ids.some((id) => !(id in articles))) throw new Error("Missing/duplicate feed article identity");
    const channel = channelFrom(await readFile(path.join(root, `feeds/${feed}/feed.xml`), "utf8"));
    if (channel.link !== new URL(`${base}feeds/${feed}/`, defaultLink).href) throw new Error("RSS channel URL mismatch");
    const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
    if (items.length !== count) throw new Error("RSS item/count mismatch");
    const guids = items.map((item) => {
      const guid = object(object(item, "RSS item").guid, "RSS GUID");
      const value = string(guid["#text"], "RSS GUID value");
      if (!/^urn:sha256:[a-f0-9]{64}$/.test(value) || guid["@_isPermaLink"] !== "false") throw new Error("Invalid RSS GUID semantics");
      return value;
    });
    if (new Set(guids).size !== guids.length || guids.some((guid) => !ids.includes(guid.replace(/^urn:sha256:/, "")))) throw new Error("RSS GUID mismatch");
  }
  if (await readFile(path.join(root, "feed.xml"), "utf8") !== await readFile(path.join(root, `feeds/${suffix[1]}/feed.xml`), "utf8")) throw new Error("Default RSS differs from its named feed");
  for (const file of files.keys()) {
    if (!file.endsWith(".html")) continue;
    const document = parse(await readFile(path.join(root, file), "utf8"));
    const visit = (node: DefaultTreeAdapterMap["node"]) => {
      if ("tagName" in node) {
        for (const attr of node.attrs) {
          if (!["href", "src"].includes(attr.name) || attr.value.startsWith("#")) continue;
          const url = new URL(attr.value, new URL(base + file, defaultLink));
          if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error(`Unsafe URL in ${file}`);
          if (url.origin !== defaultLink.origin) {
            if (node.tagName !== "a") throw new Error(`External asset in ${file}`);
            continue;
          }
          if (!url.pathname.startsWith(base)) throw new Error(`Link escapes site base in ${file}`);
          let target = decodeURIComponent(url.pathname.slice(base.length));
          if (!target || target.endsWith("/")) target += "index.html";
          requireFile(target);
        }
      }
      if ("childNodes" in node) for (const child of node.childNodes) visit(child);
    };
    visit(document);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [root, ...flags] = process.argv.slice(2);
  if (!root || flags.some((flag) => flag !== "--allow-missing")) throw new Error("Usage: node scripts/validate.ts DIRECTORY [--allow-missing]");
  let exists = true;
  try { await lstat(root); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !flags.includes("--allow-missing")) throw error;
    exists = false;
  }
  if (exists) {
    await validateSite(root, process.env.PREVIOUS_SITE, process.env.ALLOW_FEED_SHRINK === "true");
    console.log("Complete static snapshot validated.");
  } else {
    console.log("No generated snapshot yet; deployment is disabled.");
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publishable=${exists}\n`);
}
