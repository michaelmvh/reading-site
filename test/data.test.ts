import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadData, sha256, validateTransition } from "../scripts/data.ts";
import { writeFixture } from "./fixtures.ts";

test("schema, checksums, reference integrity, and private-file guards are enforced", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reader-data-"));
  try {
    const snapshot = await writeFixture(root);
    const data = await loadData(root);
    assert.equal(data.articles.size, 4);
    assert.equal(data.snapshot.feeds[0].article_ids.length, 3);
    await writeFile(path.join(root, "secrets.env"), "FIXTURE=not-a-real-secret");
    await assert.rejects(loadData(root), /Unexpected files/);
    await rm(path.join(root, "secrets.env"));
    const file = snapshot.article_files[0];
    const raw = await readFile(path.join(root, file.path), "utf8");
    await writeFile(path.join(root, file.path), raw + " ");
    await assert.rejects(loadData(root), /checksum mismatch/);
    await writeFile(path.join(root, file.path), raw);
    snapshot.feeds[0].matches[snapshot.feeds[0].article_ids[0]] = ["unknown-author"];
    await writeFile(path.join(root, "snapshot.json"), JSON.stringify(snapshot));
    await assert.rejects(loadData(root), /unknown tracked author/);
    await writeFixture(root);
    await symlink("snapshot.json", path.join(root, "extra.json"));
    await assert.rejects(loadData(root), /Unexpected files/);
  } finally { await rm(root, { recursive: true }); }
});

test("data transitions cannot silently lose retained articles, feeds, or freshness", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reader-transition-"));
  try {
    await writeFixture(root);
    const old = await loadData(root);
    const next = { ...old, snapshot: structuredClone(old.snapshot), articles: new Map(old.articles) };
    next.snapshot.feeds[0].article_ids = next.snapshot.feeds[0].article_ids.slice(0, 1);
    assert.throws(() => validateTransition(next, old, false), /40%/);
    validateTransition(next, old, true);
    next.articles.delete(sha256("retained"));
    assert.throws(() => validateTransition(next, old, true), /Retained article/);
    next.articles = new Map(old.articles);
    next.snapshot.generated_at = "2020-01-01T00:00:00Z";
    assert.throws(() => validateTransition(next, old, true), /older snapshot/);
  } finally { await rm(root, { recursive: true }); }
});

test("valid checksums do not excuse private fields or unsafe article URLs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reader-contract-"));
  try {
    for (const mutation of [
      (article: object) => Reflect.set(article, "api_key", "fixture-only"),
      (article: object) => Reflect.set(article, "link", "javascript:alert(1)"),
    ]) {
      const snapshot = await writeFixture(root);
      const entry = snapshot.article_files[0];
      const shard: unknown = JSON.parse(await readFile(path.join(root, entry.path), "utf8"));
      assert.ok(shard && typeof shard === "object" && "articles" in shard && Array.isArray(shard.articles));
      mutation(shard.articles[0]);
      const bytes = JSON.stringify(shard);
      await writeFile(path.join(root, entry.path), bytes);
      entry.sha256 = sha256(bytes);
      await writeFile(path.join(root, "snapshot.json"), JSON.stringify(snapshot));
      await assert.rejects(loadData(root), /Invalid article shard/);
    }
  } finally { await rm(root, { recursive: true }); }
});
