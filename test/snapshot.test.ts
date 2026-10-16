import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validateSite } from "../scripts/validate.ts";

const id = "a".repeat(64);
async function fixture(root: string): Promise<void> {
  const generated_at = new Date().toISOString();
  const article = {
    id, feed: "example", keys: ["https://example.org/paper"],
    publication: {
      id: "work-one", title: "Example paper", link: "https://example.org/paper", pdf_url: null,
      publication_date: "2026-10-01", collection_date: null, venue: null, authors: [],
      abstract_text: "Example abstract", discovery_sources: [], curated_categories: [],
    },
  };
  const xml = `<rss version="2.0"><channel><title>Example</title><link>https://reading.example.org/feeds/example/</link><description>Fixture</description><item><title>Paper</title><guid isPermaLink="false">urn:sha256:${id}</guid></item></channel></rss>`;
  const files = {
    "index.html": '<!doctype html><a href="/feeds/example/">Feed</a>',
    "404.html": '<!doctype html><a href="/">Home</a>',
    "reader.css": "body{color:black}", "static-reader.mjs": "export {};", "static-model.mjs": "export {};",
    "favicon.svg": "<svg/>", "apple-touch-icon.png": "fixture",
    "feed.xml": xml, "feeds/example/feed.xml": xml,
    "feeds/example/index.html": `<!doctype html><a href="/article/${id}/">Paper</a>`,
    [`article/${id}/index.html`]: '<!doctype html><a href="https://example.org/paper">Publisher</a>',
    "status.json": JSON.stringify({ schema_version: 1, generated_at, generator_version: "fixture", feeds: { example: 1 }, source_freshness: "fixture" }),
    "data/archive.json": JSON.stringify({ schema_version: 1, articles: { [id]: article } }),
    "data/example.json": JSON.stringify({ schema_version: 1, name: "example", title: "Example", description: "Fixture", generated_at, sources: [], articles: [article] }),
  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
}

test("a complete snapshot validates, but broken links and malformed XML do not", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reading-snapshot-"));
  try {
    await fixture(root);
    await validateSite(root);
    await writeFile(path.join(root, "index.html"), '<a href="/missing.html">Broken</a>');
    await assert.rejects(validateSite(root), /Missing generated file/);
    await fixture(root);
    await writeFile(path.join(root, "feeds/example/feed.xml"), "<rss>");
    await assert.rejects(validateSite(root), /Invalid RSS XML/);
  } finally { await rm(root, { recursive: true }); }
});

test("record mismatches and unexpected private fields are rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reading-fields-"));
  try {
    await fixture(root);
    const file = path.join(root, "data/archive.json");
    const archive = JSON.parse(await readFile(file, "utf8"));
    archive.articles[id].publication.contact_email = "placeholder";
    await writeFile(file, JSON.stringify(archive));
    await assert.rejects(validateSite(root), /Unexpected fields/);
    await fixture(root);
    const feed = path.join(root, "data/example.json");
    const data = JSON.parse(await readFile(feed, "utf8"));
    data.articles = [];
    await writeFile(feed, JSON.stringify(data));
    await assert.rejects(validateSite(root), /count mismatch/);
  } finally { await rm(root, { recursive: true }); }
});
