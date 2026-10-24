import { XMLBuilder } from "fast-xml-parser";
import { sourceKey, type Article, type Dataset, type Feed } from "../src/data-model.ts";

export class Site {
  readonly url: URL;
  constructor(value: string) {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Site URL requires HTTPS, except localhost previews");
    if (url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9/_-]*$/.test(url.pathname)) throw new Error("Invalid site URL/base path");
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    this.url = url;
  }
  path(relative: string): string { return `${this.url.pathname}${relative}`; }
  absolute(relative: string): string { return `${this.url.href}${relative}`; }
}

export const escape = (value: string): string => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

function layout(site: Site, title: string, rss: string, body: string, description = title, rssTitle = title): string {
  const root = escape(site.url.pathname);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${escape(description)}">
<title>${escape(title)}</title><link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" sizes="180x180" href="${root}apple-touch-icon.png">
<link rel="stylesheet" href="${root}reader.css"><link rel="alternate" type="application/rss+xml" title="${escape(rssTitle)}" href="${escape(rss)}">
<script type="module" src="${root}assets/reader.js"></script></head>
<body><main data-static-root="${root}">${body}</main></body></html>\n`;
}

function date(article: Article): string {
  if (article.publication_date) {
    const raw = article.publication_date;
    const value = article.publication_date_precision === "year" ? raw.slice(0, 4)
      : new Date(`${raw}T00:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC", year: "numeric", month: "long",
        ...(article.publication_date_precision === "month" ? {} : { day: "numeric" }),
      });
    return `<time datetime="${escape(raw)}"${article.publication_date_precision === "unknown" ? ' title="Source date; precision not specified"' : ""}>${escape(value)}</time>`;
  }
  return article.collection_date
    ? `Added to collection <a href="${escape(article.collection_date.commit_url)}" rel="external"><time datetime="${article.collection_date.date}">${escape(new Date(`${article.collection_date.date}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }))}</time></a>`
    : "";
}

function metadata(article: Article): string {
  const parts = [date(article), article.venue ? escape(article.venue) : ""].filter(Boolean);
  return `<p class="metadata">${parts.join(' <span aria-hidden="true"> · </span> ')}</p>`;
}

function authors(article: Article, matched: string[], contextual = false): string {
  if (!article.authors.length) return "";
  return `<p class="authors">${article.authors.map((author) => {
    const key = contextual ? ` data-author-key="${escape(author.key)}"` : "";
    return matched.includes(author.key) ? `<strong class="notable-author"${key}>${escape(author.name)}</strong>`
      : contextual ? `<span${key}>${escape(author.name)}</span>` : escape(author.name);
  }).join(", ")}</p>`;
}

function provenance(article: Article): string {
  const render = (sources: Article["discovery_sources"]) => sources.map((source) => source.url
    ? `<a href="${escape(source.url)}" rel="external">${escape(source.label)}</a>` : escape(source.label)).join(", ");
  const native = article.discovery_sources.filter((source) => source.kind === "biorxiv" || source.kind === "arxiv");
  const curated = article.discovery_sources.filter((source) => source.kind === "curated_collection");
  return (native.length ? `<p class="provenance">Preprint source: ${render(native)}</p>` : "")
    + (curated.length ? `<p class="provenance">Curated by ${render(curated)}${article.curated_categories.length ? ` · ${escape(article.curated_categories.join(" · "))}` : ""}</p>` : "");
}

const authorNote = '<strong class="notable-author">Highlighted authors</strong> matched this feed.';

function defaultMatch(feed: Feed, article: Article): boolean {
  const matches = feed.matches[article.id];
  return !matches.length || feed.authors.some((author) => author.default_selected && matches.includes(author.id));
}

function card(site: Site, feed: Feed, article: Article): string {
  return `<li class="publication" data-article="${article.id}" data-date="${article.publication_date ?? ""}"
data-default-author="${defaultMatch(feed, article)}" data-authors="${escape(JSON.stringify(feed.matches[article.id]))}"
data-sources="${escape(JSON.stringify(article.discovery_sources.map(sourceKey)))}"${defaultMatch(feed, article) ? "" : " hidden"}>
${metadata(article)}<h2><a href="${site.path(`article/${article.id}/`)}">${escape(article.title)}</a></h2>
${authors(article, feed.matches[article.id])}${provenance(article)}</li>`;
}

function controls(feed: Feed): string {
  const options = [...feed.authors].sort((a, b) => a.label.localeCompare(b.label));
  const selected = options.filter((author) => author.default_selected);
  const summary = selected.length === options.length ? "All tracked authors" : selected.length === 0 ? "No tracked authors"
    : selected.length === 1 ? selected[0].label : `${selected.length} selected`;
  const authors = options.map((author) => `<label class="filter-checkbox"><input type="checkbox" name="author" value="${escape(author.id)}" data-label="${escape(author.label)}" data-default="${author.default_selected}"${author.default_selected ? " checked" : ""}><span>${escape(author.label)}</span></label>`).join("");
  const groups = ["Core feed", "bioRxiv", "arXiv"].map((group) => {
    const sources = feed.sources.filter((source) => (source.value.startsWith("biorxiv:") ? "bioRxiv" : source.value.startsWith("arxiv:") ? "arXiv" : "Core feed") === group);
    if (!sources.length) return "";
    return `<div class="filter-option-group"><strong>${group}</strong>${sources.map((source) => `<label class="filter-checkbox"><input type="checkbox" name="source" value="${escape(source.value)}" data-label="${escape(source.label)}" checked><span>${escape(source.label)}</span></label>`).join("")}</div>`;
  }).join("");
  return `<p class="reader-note" data-filter-notice>Enable JavaScript to filter this snapshot.</p><p class="reader-note" data-filter-error role="alert" hidden></p>
<form class="filters" data-static-filters hidden><input type="hidden" name="authors" value="default"><div class="filter-fields">
<label class="filter-select">Publication date<select name="period"><option value="">All available</option><option value="30d">Past 30 days</option><option value="90d">Past 90 days</option><option value="1y">Past year</option></select></label>
${options.length ? `<details class="filter-multiselect" data-author-picker><summary><span class="filter-label">Tracked authors</span><span class="filter-value" data-author-summary>${escape(summary)}</span></summary>
<div class="filter-options"><label class="filter-checkbox filter-select-all"><input type="checkbox" data-select-all${selected.length === options.length ? " checked" : ""}><span>All tracked authors</span></label>
<div class="filter-option-list">${authors}</div></div></details>` : ""}
<details class="filter-multiselect" data-source-picker><summary><span class="filter-label">Paper sources</span><span class="filter-value" data-source-summary>${escape(feed.sources.length === 1 ? feed.sources[0].label : `${feed.sources.length} selected`)}</span></summary><div class="filter-options"><div class="filter-option-list">${groups}</div></div></details>
</div><div class="filter-actions" hidden><button class="clear-filters" type="reset">Clear filters</button></div></form>`;
}

export function renderFeed(site: Site, data: Dataset, feed: Feed): string {
  const articles = feed.article_ids.map((id) => data.articles.get(id)!);
  const visible = articles.filter((article) => defaultMatch(feed, article)).length;
  const rss = site.path(`feeds/${feed.id}/feed.xml`);
  return layout(site, feed.title, rss, `<header><h1>${escape(feed.title)}</h1>
<p class="intro">${escape(feed.description)}</p><p class="feed-meta"><span data-filter-count aria-live="polite">${visible === articles.length ? `${visible} ${visible === 1 ? "publication" : "publications"}` : `${visible} of ${articles.length} publications`}</span><a href="${rss}">View raw RSS</a></p>
${feed.authors.length ? `<p class="author-key">${authorNote}</p>` : ""}
${controls(feed)}</header><ol class="publication-list">${articles.map((article) => card(site, feed, article)).join("\n")}</ol>
<p class="empty" data-filter-empty${visible ? " hidden" : ""}>No publications match these filters.</p>
<footer class="reader-note"><p>Data collected <time datetime="${data.snapshot.generated_at}">${escape(new Date(data.snapshot.generated_at).toUTCString())}</time>.</p>
<p>RSS includes all articles in this feed. Browser filters do not change the subscription.</p></footer>`, feed.description);
}

export function renderArticle(site: Site, data: Dataset, article: Article): string {
  const feed = data.snapshot.feeds.find((feed) => feed.id === data.snapshot.default_feed && feed.article_ids.includes(article.id))
    ?? data.snapshot.feeds.find((feed) => feed.article_ids.includes(article.id))
    ?? data.snapshot.feeds.find((feed) => feed.id === data.snapshot.default_feed)!;
  const matched = feed.matches[article.id] ?? [];
  const contexts = data.snapshot.feeds.filter((other) => other.article_ids.includes(article.id)).map((other) =>
    `<span hidden data-article-feed="${other.id}" data-default-feed="${other.id === data.snapshot.default_feed}" data-feed-title="${escape(other.title)}" data-feed-matches="${escape(JSON.stringify(other.matches[article.id]))}"></span>`).join("");
  const rss = site.path(`feeds/${feed.id}/feed.xml`);
  const link = (url: string | null, label: string, css: string) => url ? `<a class="${css}" href="${escape(url)}" target="_blank" rel="external noopener">${label} <span aria-hidden="true">&#8599;</span></a>` : "";
  return layout(site, `${article.title} · ${feed.title}`, site.path(`feeds/${feed.id}/feed.xml`),
    `<a class="back" href="${site.path(`feeds/${feed.id}/`)}">&#8592; Back to all publications</a><p class="reader-note" data-navigation-error role="alert" hidden></p><article class="article-detail">
${contexts}${metadata(article)}<h1>${escape(article.title)}</h1>${authors(article, matched, true)}${provenance(article)}
<p class="author-note"${matched.length ? "" : " hidden"}>${authorNote}</p>
<section class="abstract" aria-labelledby="abstract-heading"><h2 id="abstract-heading">Abstract</h2><p>${escape(article.abstract_text?.trim() ? article.abstract_text : "No abstract is available for this publication.")}</p></section>
<p class="actions">${link(article.link, "Read full article", "primary-action")}${link(article.pdf_url, "Open PDF", "secondary-action")}<a data-feed-rss href="${rss}">View raw RSS</a></p></article>`, `Abstract for ${article.title}`, feed.title);
}

export function renderNotFound(site: Site): string {
  return layout(site, "Page not found", site.path("feed.xml"), `<h1>Page not found</h1><p>This URL may belong to the retired reader.</p><a href="${site.path("")}">Open the reading site</a>`);
}

export function renderRss(site: Site, data: Dataset, feed: Feed): string {
  const item = feed.article_ids.map((id) => {
    const article = data.articles.get(id)!;
    const description = `<p>${escape(article.abstract_text || "No abstract is available.")}</p>${metadata(article)}${provenance(article)}`
      + (article.link ? `<p><a href="${escape(article.link)}">Original publication</a></p>` : "")
      + (article.pdf_url ? `<p><a href="${escape(article.pdf_url)}">Open PDF</a></p>` : "");
    return {
      title: article.title, link: site.absolute(`article/${id}/`),
      guid: { "#text": `urn:sha256:${id}`, "@_isPermaLink": "false" }, description,
      ...(article.publication_date && ["day", "unknown"].includes(article.publication_date_precision)
        ? { pubDate: new Date(`${article.publication_date}T00:00:00Z`).toUTCString() } : {}),
      "dc:creator": article.authors.map((author) => author.name),
      category: article.discovery_sources.map((source) => source.label),
    };
  });
  return new XMLBuilder({ ignoreAttributes: false, format: true }).build({
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    rss: {
      "@_version": "2.0", "@_xmlns:atom": "http://www.w3.org/2005/Atom", "@_xmlns:dc": "http://purl.org/dc/elements/1.1/",
      channel: {
        title: feed.title, link: site.absolute(`feeds/${feed.id}/`), description: feed.description,
        language: "en-US", ttl: 1440, lastBuildDate: new Date(data.snapshot.generated_at).toUTCString(),
        "atom:link": { "@_href": site.absolute(`feeds/${feed.id}/feed.xml`), "@_rel": "self", "@_type": "application/rss+xml" },
        item,
      },
    },
  });
}
