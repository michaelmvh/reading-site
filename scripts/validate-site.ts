import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Dataset } from "../src/data-model.ts";
import { loadData } from "./data.ts";
import { Site } from "./render.ts";

async function inventory(root: string, prefix = ""): Promise<Map<string, number>> {
  const files = new Map<string, number>();
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = await lstat(path.join(root, relative));
    if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) throw new Error(`Output links are forbidden: ${relative}`);
    if (stat.isDirectory()) for (const item of await inventory(root, relative)) files.set(...item);
    else if (stat.isFile() && stat.size) files.set(relative, stat.size);
    else throw new Error(`Empty or unsupported output: ${relative}`);
  }
  return files;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed RSS object");
  return value as Record<string, unknown>;
}
export function rssChannel(xml: string, decodeEntities = false): Record<string, unknown> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid RSS XML");
  const value: unknown = new XMLParser({ ignoreAttributes: false, processEntities: decodeEntities }).parse(xml);
  return object(object(object(value).rss).channel);
}

export async function validateSite(root: string, data: Dataset, site: Site): Promise<void> {
  const files = await inventory(root);
  const expected = new Set(["index.html", "404.html", "feed.xml", "status.json", "reader.css", "favicon.svg", "apple-touch-icon.png", "assets/model.js", "assets/reader.js", "assets/collections.js"]);
  for (const feed of data.snapshot.feeds) { expected.add(`feeds/${feed.id}/index.html`); expected.add(`feeds/${feed.id}/feed.xml`); }
  for (const id of data.articles.keys()) expected.add(`article/${id}/index.html`);
  if (expected.size !== files.size || [...expected].some((file) => !files.has(file))) throw new Error("Missing or unexpected generated files");
  if ([...files.values()].reduce((sum, size) => sum + size, 0) > 500 * 1024 * 1024) throw new Error("Site exceeds 500 MiB");
  const status: unknown = JSON.parse(await readFile(path.join(root, "status.json"), "utf8"));
  const statusRecord = object(status);
  if (statusRecord.data_generated_at !== data.snapshot.generated_at || statusRecord.data_digest !== data.digest) throw new Error("Site freshness does not match its source data");
  for (const feed of data.snapshot.feeds) {
    const channel = rssChannel(await readFile(path.join(root, `feeds/${feed.id}/feed.xml`), "utf8"));
    if (channel.link !== site.absolute(`feeds/${feed.id}/`)) throw new Error("RSS URL mismatch");
    if (channel.lastBuildDate !== new Date(data.snapshot.generated_at).toUTCString()) throw new Error("RSS uses build time instead of collection time");
    const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
    const ids = items.map((value) => {
      const guid = object(object(value).guid);
      if (guid["@_isPermaLink"] !== "false" || typeof guid["#text"] !== "string" || !/^urn:sha256:[a-f0-9]{64}$/.test(guid["#text"])) throw new Error("Invalid RSS GUID");
      return guid["#text"].slice("urn:sha256:".length);
    });
    if (ids.length !== feed.article_ids.length || ids.some((id, index) => id !== feed.article_ids[index])) throw new Error("RSS and JSON feed membership differ");
  }
  if (await readFile(path.join(root, "feed.xml"), "utf8") !== await readFile(path.join(root, `feeds/${data.snapshot.default_feed}/feed.xml`), "utf8")) throw new Error("Default RSS alias mismatch");
  for (const file of files.keys()) {
    if (!file.endsWith(".html")) continue;
    const document = parse(await readFile(path.join(root, file), "utf8"));
    const visit = (node: DefaultTreeAdapterMap["node"]) => {
      if ("tagName" in node) for (const attr of node.attrs) {
        if (!["href", "src"].includes(attr.name) || attr.value.startsWith("#")) continue;
        const url = new URL(attr.value, site.absolute(file));
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error(`Unsafe URL in ${file}`);
        if (node.tagName === "a" && node.attrs.some((attribute) => attribute.name === "rel" && attribute.value.split(/\s+/).includes("external"))) continue;
        if (url.origin !== site.url.origin) {
          if (node.tagName !== "a") throw new Error("External reader asset");
          continue;
        }
        if (!url.pathname.startsWith(site.url.pathname)) throw new Error("Link escapes reader base path");
        let target = decodeURIComponent(url.pathname.slice(site.url.pathname.length));
        if (!target || target.endsWith("/")) target += "index.html";
        if (!files.has(target)) throw new Error(`Broken local link: ${file} -> ${target}`);
      }
      if ("childNodes" in node) for (const child of node.childNodes) visit(child);
    };
    visit(document);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await validateSite("dist", await loadData(process.env.DATA_DIR || "data"), new Site(process.env.SITE_URL || "https://michaelmvh.com/reading-site/"));
  console.log("Generated HTML, RSS, assets, links, and data freshness validated.");
}
