import { execFile } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadData } from "./data.ts";
import { renderArticle, renderFeed, renderNotFound, renderRss, Site } from "./render.ts";
import type { Dataset } from "../src/data-model.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const execute = promisify(execFile);

export async function buildSite(data: Dataset, output: string, site: Site, builtAt = new Date().toISOString()): Promise<void> {
  const write = async (relative: string, contents: string) => {
    const file = path.join(output, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  };
  for (const feed of data.snapshot.feeds) {
    const html = renderFeed(site, data, feed);
    const rss = renderRss(site, data, feed);
    await write(`feeds/${feed.id}/index.html`, html);
    await write(`feeds/${feed.id}/feed.xml`, rss);
    if (feed.id === data.snapshot.default_feed) { await write("index.html", html); await write("feed.xml", rss); }
  }
  for (const article of data.articles.values()) await write(`article/${article.id}/index.html`, renderArticle(site, data, article));
  await write("404.html", renderNotFound(site));
  await write("status.json", JSON.stringify({
    schema_version: 1, data_generated_at: data.snapshot.generated_at, data_digest: data.digest,
    built_at: builtAt, reader_revision: process.env.GITHUB_SHA ?? null,
    feeds: Object.fromEntries(data.snapshot.feeds.map((feed) => [feed.id, feed.article_ids.length])),
    freshness_policy: data.snapshot.freshness_policy,
  }, null, 2));
  for (const file of ["reader.css", "favicon.svg", "apple-touch-icon.png"]) await copyFile(path.join(root, "src/assets", file), path.join(output, file));
  await execute(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--project", path.join(root, "tsconfig.client.json"), "--outDir", path.join(output, "assets")], { cwd: root });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = path.join(root, "dist");
  const input = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
  if (input === output || input.startsWith(`${output}${path.sep}`)) throw new Error("DATA_DIR cannot be inside the generated dist/ directory");
  const data = await loadData(input);
  // Only the repository's documented generated directory is replaced, never data/ or source.
  await rm(output, { recursive: true, force: true });
  await buildSite(data, output, new Site(process.env.SITE_URL || "https://michaelmvh.com/reading-site/"));
  console.log(`Built ${data.articles.size} article pages from data collected ${data.snapshot.generated_at}.`);
}
