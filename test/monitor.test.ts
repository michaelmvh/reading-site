import assert from "node:assert/strict";
import test from "node:test";
import { checkFreshness, checkRemote } from "../scripts/monitor.ts";

const now = Date.parse("2026-10-16T12:00:00Z");
const status = (data_generated_at: string) => ({ schema_version: 1, data_generated_at, feeds: { example: 2 } });
const response = (body: string, type = "application/json", code = 200): typeof fetch =>
  async () => new Response(body, { status: code, headers: { "Content-Type": type } });

test("monitor accepts the exact threshold and rejects stale, future, or empty snapshots", () => {
  assert.equal(checkFreshness(status("2026-10-14T12:00:00Z"), 48, now), 48);
  assert.throws(() => checkFreshness(status("2026-10-14T11:59:59Z"), 48, now), /hours old/);
  assert.throws(() => checkFreshness(status("2026-10-17T12:00:00Z"), 48, now), /future/);
  assert.throws(() => checkFreshness({ ...status("2026-10-16T12:00:00Z"), feeds: {} }, 48, now), /counts/);
  assert.throws(() => checkFreshness(status("invalid"), 48, now), /timestamp/);
  assert.throws(() => checkFreshness(status("2026-10-16T12:00:00Z"), NaN, now), /positive/);
});

test("monitor detects HTML challenges, status failures, malformed JSON, and oversized bodies", async () => {
  const url = "https://example.org/status.json";
  assert.ok(await checkRemote(url, 48, response(JSON.stringify(status(new Date().toISOString())))) < 1);
  await assert.rejects(checkRemote(url, 48, response("<html/>", "text/html")), /JSON/);
  await assert.rejects(checkRemote(url, 48, response("unavailable", "application/json", 503)), /503/);
  await assert.rejects(checkRemote(url, 48, response("{invalid")), SyntaxError);
  await assert.rejects(checkRemote(url, 48, response("x".repeat(65_537))), /64 KiB/);
  await assert.rejects(checkRemote("http://example.org/status.json", 48, response("{}")), /HTTPS/);
});
