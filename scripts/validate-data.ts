import { appendFile, lstat } from "node:fs/promises";
import { loadData, validateTransition } from "./data.ts";

const [root, ...flags] = process.argv.slice(2);
if (!root || flags.some((flag) => flag !== "--allow-missing")) throw new Error("Usage: node scripts/validate-data.ts DIRECTORY [--allow-missing]");
let exists = true;
try { await lstat(root); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !flags.includes("--allow-missing")) throw error;
  exists = false;
}
if (exists) {
  const data = await loadData(root);
  if (process.env.PREVIOUS_DATA) validateTransition(data, await loadData(process.env.PREVIOUS_DATA), process.env.ALLOW_FEED_SHRINK === "true");
  console.log(`Validated JSON: ${data.articles.size} retained articles, ${data.snapshot.feeds.length} feeds, data generated ${data.snapshot.generated_at}.`);
} else {
  console.log("No article snapshot yet; production deployment remains disabled.");
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publishable=${exists}\n`);
