import path from "node:path";
import { pathToFileURL } from "node:url";

export function checkFreshness(value: unknown, maxAgeHours = 48, now = Date.now()): number {
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error("Maximum age must be a positive number of hours");
  if (typeof value !== "object" || value === null || !("schema_version" in value) || value.schema_version !== 1
    || !("generated_at" in value) || typeof value.generated_at !== "string"
    || !("feeds" in value) || typeof value.feeds !== "object" || value.feeds === null || Array.isArray(value.feeds)) {
    throw new Error("Endpoint did not return a supported reading-site status document");
  }
  const counts: unknown[] = Object.values(value.feeds);
  if (!counts.length || counts.some((count) => typeof count !== "number" || !Number.isSafeInteger(count) || count < 1)) {
    throw new Error("Published snapshot has missing/invalid feed counts");
  }
  const generated = Date.parse(value.generated_at);
  if (!Number.isFinite(generated) || generated > now + 300_000) throw new Error("Snapshot generation timestamp is invalid or in the future");
  const age = (now - generated) / 3_600_000;
  if (age > maxAgeHours) throw new Error(`Snapshot is ${age.toFixed(1)} hours old (limit ${maxAgeHours})`);
  return Math.max(age, 0);
}

export async function checkRemote(url: string, maxAgeHours = 48, fetcher: typeof fetch = fetch): Promise<number> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash) {
    throw new Error("Monitor URL must use HTTPS without credentials, query parameters, or fragments");
  }
  const response = await fetcher(target, { signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error(`Status endpoint returned HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Status endpoint did not return JSON");
  if (!response.body) throw new Error("Status endpoint returned no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65_536) {
      await reader.cancel();
      throw new Error("Status document exceeds 64 KiB");
    }
    chunks.push(value);
  }
  const document: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return checkFreshness(document, maxAgeHours);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const url = process.env.STATUS_URL;
  if (!url) throw new Error("Set STATUS_URL to the deployed /status.json endpoint");
  const age = await checkRemote(url, Number(process.env.MAX_SNAPSHOT_AGE_HOURS || "48"));
  console.log(`Reading snapshot is reachable and ${age.toFixed(1)} hours old. This does not certify upstream source freshness.`);
}
