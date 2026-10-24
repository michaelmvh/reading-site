import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadData, sha256 } from "../scripts/data.ts";
import { buildSite } from "../scripts/build.ts";
import { renderArticle, renderFeed, renderRss, Site } from "../scripts/render.ts";
import { rssChannel, validateSite } from "../scripts/validate-site.ts";
import { checkFreshness } from "../scripts/monitor.ts";
import { writeFixture } from "./fixtures.ts";

test("discovery labels cover every provider without duplicating tracked-author explanations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reader-provenance-"));
  try {
    await writeFixture(root);
    const data = await loadData(root);
    const site = new Site("https://example.org/");
    const tracked = data.snapshot.feeds[0];
    const untracked = data.snapshot.feeds.find((feed) => feed.id === "protein-nanopores")!;
    const article = data.articles.get(untracked.article_ids[0])!;
    const rssDescription = (feed: typeof tracked): string => {
      const channel = rssChannel(renderRss(site, data, feed), true);
      const item: unknown = Array.isArray(channel.item) ? channel.item[0] : channel.item;
      assert.ok(item && typeof item === "object" && "description" in item);
      assert.ok(typeof item.description === "string");
      return item.description;
    };
    assert.ok(!renderFeed(site, data, tracked).split("</li>")[0].includes("Discovered via"));
    assert.ok(renderFeed(site, data, untracked).includes('Discovered via <a href="https://openalex.org" rel="external">OpenAlex</a>'));
    assert.ok(renderArticle(site, data, article).includes('data-untracked-provenance hidden'));
    const untrackedData = { ...data, snapshot: { ...data.snapshot, default_feed: untracked.id } };
    assert.ok(renderArticle(site, untrackedData, article).includes('data-untracked-provenance>Discovered via'));
    for (const feed of [tracked, untracked]) {
      const description = rssDescription(feed);
      assert.equal(description.includes("Discovered via"), feed === untracked);
      assert.ok(!description.includes(" hidden"));
    }
    article.discovery_sources.push(
      { kind: "google_scholar", key: "scholar", label: "Scholar <results>", url: null },
      { kind: "biorxiv", key: "biorxiv:test", label: "bioRxiv", url: null },
      { kind: "arxiv", key: "arxiv:test", label: "arXiv", url: null },
      { kind: "curated_collection", key: "test", label: "Collection & research", url: "https://example.org/collection" },
    );
    article.curated_categories = ["Design <category>"];
    for (const html of [
      renderFeed(site, data, untracked), renderArticle(site, untrackedData, article),
      rssDescription(untracked),
    ]) {
      assert.ok(html.includes("OpenAlex</a>, Scholar &lt;results&gt;"));
      assert.ok(html.includes("Preprint source: bioRxiv, arXiv"));
      assert.ok(html.includes('Curated by <a href="https://example.org/collection" rel="external">Collection &amp; research</a> · Design &lt;category&gt;'));
    }
    const trackedHtml = renderFeed(site, data, tracked).split("</li>")[0];
    assert.ok(!trackedHtml.includes("Discovered via"));
    assert.ok(trackedHtml.includes("Preprint source:"));
    assert.ok(trackedHtml.includes("Curated by"));
  } finally { await rm(root, { recursive: true }); }
});

test("JSON alone builds complete previews, safe HTML/RSS, retained pages, and stable freshness", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reader-build-"));
  try {
    const source = path.join(root, "data");
    const generated = new Date(Date.now() - 72 * 3_600_000).toISOString();
    await writeFixture(source, generated);
    const data = await loadData(source);
    const preview = new Site("https://example.org/reading-site/");
    const output = path.join(root, "preview");
    await buildSite(data, output, preview);
    await validateSite(output, data, preview);
    const html = await readFile(path.join(output, "index.html"), "utf8");
    assert.ok(html.includes("/reading-site/assets/reader.js"));
    assert.ok(html.includes("&lt;required&gt; &amp; research"));
    assert.ok(html.includes('<meta name="description" content="Synthetic reader fixture">'));
    assert.ok(html.includes('class="author-key"'));
    assert.ok(html.includes('name="authors" value="default"'));
    assert.ok(!html.includes("Author selection"));
    assert.ok(!html.includes("Apply filters"));
    assert.ok(html.includes('<header><nav class="collection-navigation" aria-label="Reading collections">'));
    assert.ok(html.includes('<summary title="Switch reading list"><span>General research</span></summary>'));
    assert.ok(html.includes('<h1>Research &amp; Science</h1>'));
    assert.ok(!html.includes("reader-toolbar"));
    assert.ok(html.includes('<a class="collection-option" href="/reading-site/" aria-current="page">General research</a>'));
    assert.ok(html.includes('<a class="collection-option" href="/reading-site/feeds/protein-nanopores/">Protein nanopores</a>'));
    const nanopores = await readFile(path.join(output, "feeds/protein-nanopores/index.html"), "utf8");
    assert.ok(nanopores.includes('<summary title="Switch reading list"><span>Protein nanopores</span></summary>'));
    assert.ok(!nanopores.includes('class="intro"'));
    assert.ok(html.includes('<p class="intro">Synthetic reader fixture</p>'));
    assert.ok(nanopores.includes('<a class="collection-option" href="/reading-site/">General research</a>'));
    assert.ok(nanopores.includes('<a class="collection-option" href="/reading-site/feeds/protein-nanopores/" aria-current="page">Protein nanopores</a>'));
    const withoutNanopores = { ...data, snapshot: { ...data.snapshot, feeds: data.snapshot.feeds.filter((feed) => feed.id !== "protein-nanopores") } };
    assert.ok(!renderFeed(preview, withoutNanopores, data.snapshot.feeds[0]).includes('class="collection-navigation"'));
    const design = { ...data.snapshot.feeds[0], id: "protein-design", title: "Protein Design" };
    const withDesign = { ...data, snapshot: { ...data.snapshot, feeds: [...data.snapshot.feeds, design] } };
    const designHtml = renderFeed(preview, withDesign, design);
    assert.ok(designHtml.includes('<summary title="Switch reading list"><span>Protein design</span></summary>'));
    assert.ok(designHtml.includes('<a class="collection-option" href="/reading-site/feeds/protein-design/" aria-current="page">Protein design</a>'));
    assert.equal((designHtml.match(/class="collection-option"/g) ?? []).length, 3);
    assert.ok(!html.includes('href="/reading-site/feeds/protein-design/"'));
    assert.ok(html.includes("October 1, 2026</time></a>"));
    const detail = await readFile(path.join(output, `article/${sha256("retained")}/index.html`), "utf8");
    assert.ok(detail.includes("&lt;script&gt;"));
    assert.ok(!detail.includes("<script>untrusted"));
    assert.ok(detail.includes("View raw RSS"));
    assert.ok(detail.includes('class="author-note" hidden'));
    const optional = await readFile(path.join(output, `article/${sha256("optional")}/index.html`), "utf8");
    assert.ok(optional.includes('data-article-feed="native"'));
    assert.ok(optional.includes('data-feed-matches="[]"'));
    assert.ok(optional.includes('class="notable-author" data-author-key="optional"'));
    assert.ok(optional.includes("Preprint source:"));
    assert.ok(optional.includes("Curated by"));
    const native = await readFile(path.join(output, "feeds/native/index.html"), "utf8");
    assert.ok(!native.includes("data-author-picker"));
    assert.ok(!native.includes('class="author-key"'));
    assert.ok(!native.includes('class="collection-navigation"'));
    assert.ok(native.includes("<strong>bioRxiv</strong>"));
    assert.ok(native.includes("<strong>arXiv</strong>"));
    const rss = renderRss(preview, data, data.snapshot.feeds[0]);
    assert.ok(rss.includes("urn:sha256:"));
    const channel = rssChannel(rss);
    assert.ok(Array.isArray(channel.item));
    assert.equal(channel.item.length, 3); // optional-author papers remain in RSS
    assert.equal(channel.item[2].pubDate, undefined); // collection-added date is not a publication date
    const decoded = rssChannel(rss, true);
    assert.ok(Array.isArray(decoded.item));
    const description = decoded.item[0].description;
    assert.equal(typeof description, "string");
    assert.ok(description.includes("&lt;script&gt;"));
    assert.ok(!description.includes("<script>"));
    const status = JSON.parse(await readFile(path.join(output, "status.json"), "utf8"));
    assert.equal(status.data_generated_at, generated);
    assert.throws(() => checkFreshness(status), /hours old/);
    const production = path.join(root, "production");
    await buildSite(data, production, new Site("https://reading.example.org/"));
    const rebuilt = JSON.parse(await readFile(path.join(production, "status.json"), "utf8"));
    assert.equal(rebuilt.data_generated_at, generated);
    assert.equal(rebuilt.data_digest, status.data_digest);
    await validateSite(production, data, new Site("https://reading.example.org/"));
    await writeFile(path.join(production, "index.html"), '<a href="/missing/">Broken</a>');
    await assert.rejects(validateSite(production, data, new Site("https://reading.example.org/")), /Broken local link/);
  } finally { await rm(root, { recursive: true }); }
});
