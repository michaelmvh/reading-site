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

function layout(site: Site, title: string, rss: string, body: string): string {
  const root = escape(site.url.pathname);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" sizes="180x180" href="${root}apple-touch-icon.png">
<link rel="stylesheet" href="${root}reader.css"><link rel="alternate" type="application/rss+xml" title="${escape(title)}" href="${escape(rss)}">
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
    ? `Added to collection <a href="${escape(article.collection_date.commit_url)}" rel="external"><time datetime="${article.collection_date.date}">${article.collection_date.date}</time></a>`
    : "";
}

function metadata(article: Article): string {
  const parts = [date(article), article.venue ? escape(article.venue) : ""].filter(Boolean);
  return `<p class="metadata">${parts.join(' <span aria-hidden="true"> · </span> ')}</p>`;
}

function authors(article: Article, matched: string[]): string {
  if (!article.authors.length) return "";
  return `<p class="authors">${article.authors.map((author) => matched.includes(author.key)
    ? `<strong class="notable-author">${escape(author.name)}</strong>` : escape(author.name)).join(", ")}</p>`;
}

function provenance(article: Article): string {
  const sources = article.discovery_sources.filter((source) => source.kind !== "open_alex" && source.kind !== "google_scholar");
  if (!sources.length) return "";
  return `<p class="provenance">Discovered through ${sources.map((source) => source.url
    ? `<a href="${escape(source.url)}" rel="external">${escape(source.label)}</a>` : escape(source.label)).join(", ")}${article.curated_categories.length ? ` · ${escape(article.curated_categories.join(" · "))}` : ""}</p>`;
}

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

function controls(feed: Feed, visible: number): string {
  const options = [...feed.authors].sort((a, b) => a.label.localeCompare(b.label));
  const authors = options.map((author) => `<label class="filter-checkbox"><input type="checkbox" name="author" value="${escape(author.id)}" data-default="${author.default_selected}"${author.default_selected ? " checked" : ""}>${escape(author.label)}</label>`).join("");
  const sources = feed.sources.map((source) => `<label class="filter-checkbox"><input type="checkbox" name="source" value="${escape(source.value)}" checked>${escape(source.label)}</label>`).join("");
  return `<p data-filter-notice>Enable JavaScript to filter this snapshot.</p><p data-filter-error role="alert" hidden></p>
<form class="filters" data-static-filters hidden><div class="filter-fields">
<label class="filter-select">Publication date<select name="period"><option value="">All available</option><option value="30d">Past 30 days</option><option value="90d">Past 90 days</option><option value="1y">Past year</option></select></label>
<label class="filter-select">Author selection<select name="authors"><option value="default">Configured defaults</option><option value="all">All tracked authors</option><option value="custom">Custom selection</option></select></label>
<details class="filter-multiselect"><summary><span class="filter-label">Tracked authors</span><span class="filter-value" data-author-summary>Configured defaults</span></summary><div class="filter-options">${authors}</div></details>
<details class="filter-multiselect"><summary><span class="filter-label">Paper sources</span><span class="filter-value" data-source-summary>All collected sources</span></summary><div class="filter-options">${sources}</div></details>
</div><div class="filter-actions"><button type="submit">Apply filters</button><button type="reset">Clear filters</button></div></form>
<p data-filter-count aria-live="polite">${visible} of ${feed.article_ids.length} publications</p>
<p>Subscriptions include all articles in this named feed; browser filters do not change RSS.</p>`;
}

export function renderFeed(site: Site, data: Dataset, feed: Feed): string {
  const articles = feed.article_ids.map((id) => data.articles.get(id)!);
  const visible = articles.filter((article) => defaultMatch(feed, article)).length;
  const nav = data.snapshot.feeds.map((other) => `<a href="${site.path(`feeds/${other.id}/`)}"${other.id === feed.id ? ' aria-current="page"' : ""}>${escape(other.title)}</a>`).join(" · ");
  const rss = site.path(`feeds/${feed.id}/feed.xml`);
  return layout(site, feed.title, rss, `<header><nav aria-label="Feeds">${nav}</nav><h1>${escape(feed.title)}</h1>
<p class="intro">${escape(feed.description)}</p><p class="feed-meta"><a href="${rss}">Subscribe to this feed</a></p>
<p>Data collected <time datetime="${data.snapshot.generated_at}">${escape(new Date(data.snapshot.generated_at).toUTCString())}</time>.</p>
${controls(feed, visible)}</header><ol class="publication-list">${articles.map((article) => card(site, feed, article)).join("\n")}</ol>
<p data-filter-empty${visible ? " hidden" : ""}>No publications match these filters.</p>`);
}

export function renderArticle(site: Site, data: Dataset, article: Article): string {
  const feed = data.snapshot.feeds.find((feed) => feed.id === data.snapshot.default_feed && feed.article_ids.includes(article.id))
    ?? data.snapshot.feeds.find((feed) => feed.article_ids.includes(article.id))
    ?? data.snapshot.feeds.find((feed) => feed.id === data.snapshot.default_feed)!;
  const matched = data.snapshot.feeds.flatMap((feed) => feed.matches[article.id] ?? []);
  const link = (url: string | null, label: string, css: string) => url ? `<a class="${css}" href="${escape(url)}" target="_blank" rel="external noopener">${label}</a>` : "";
  return layout(site, `${article.title} · ${feed.title}`, site.path(`feeds/${feed.id}/feed.xml`),
    `<a class="back" href="${site.path(`feeds/${feed.id}/`)}">Back to publications</a><article class="article-detail">
${metadata(article)}<h1>${escape(article.title)}</h1>${authors(article, matched)}${provenance(article)}
<section class="abstract" aria-labelledby="abstract-heading"><h2 id="abstract-heading">Abstract</h2><p>${escape(article.abstract_text || "No abstract is available for this publication.")}</p></section>
<p class="actions">${link(article.link, "Read full article", "primary-action")}${link(article.pdf_url, "Open PDF", "secondary-action")}</p></article>`);
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
