import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadData, sha256, validateTransition } from "../scripts/data.ts";
import { writeAliasFixture, writeFixture } from "./fixtures.ts";
import type { Shard } from "../src/data-model.ts";

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

test("source mismatches identify the feed, article, selected sources, and identities", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reader-source-mismatch-"));
  try {
    const snapshot = await writeFixture(root);
    const id = snapshot.feeds[0].article_ids[0];
    snapshot.feeds[0].sources = [{ value: "curated:example", label: "Example collection" }];
    await writeFile(path.join(root, "snapshot.json"), JSON.stringify(snapshot));
    await assert.rejects(loadData(root), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes('Feed "example"'));
      assert.ok(error.message.includes(id));
      assert.ok(error.message.includes('article sources=["core"]'));
      assert.ok(error.message.includes('selected sources=["curated:example"]'));
      assert.ok(error.message.includes("https://example.org/required"));
      return true;
    });
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

test("retained aliases preserve transitions and reject missing, chained, or ambiguous ownership", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reader-alias-"));
  try {
    await writeFixture(root);
    const previous = await loadData(root);
    const snapshot = await writeAliasFixture(root);
    const current = await loadData(root);
    validateTransition(current, previous, false);
    const id = sha256("retained");
    assert.equal(current.articles.get(id)?.canonical_id, sha256("required"));
    const lostIdentity = structuredClone(current);
    lostIdentity.articles.get(sha256("required"))!.identity_keys = ["required"];
    assert.throws(() => validateTransition(lostIdentity, current, false), /lost source identities/);
    const reassignedAlias = structuredClone(current);
    reassignedAlias.articles.get(id)!.canonical_id = sha256("optional");
    assert.throws(() => validateTransition(reassignedAlias, current, false), /unrelated canonical article/);
    const entry = snapshot.article_files.find((file) => file.path === `articles/${id.slice(0, 2)}.json`)!;
    const valid: Shard = JSON.parse(await readFile(path.join(root, entry.path), "utf8"));
    for (const [canonical, keys, error] of [
      [sha256("missing"), [], /existing canonical article/],
      [id, [], /existing canonical article/],
      [sha256("required"), ["retained"], /Invalid article shard/],
      [undefined, [], /Invalid article shard/],
    ] as const) {
      const shard = structuredClone(valid);
      const alias = shard.articles.find((article) => article.id === id)!;
      alias.canonical_id = canonical;
      alias.identity_keys = [...keys];
      const bytes = JSON.stringify(shard);
      entry.sha256 = sha256(bytes);
      await writeFile(path.join(root, entry.path), bytes);
      await writeFile(path.join(root, "snapshot.json"), JSON.stringify(snapshot));
      await assert.rejects(loadData(root), error);
    }
    const aliasSnapshot = await writeAliasFixture(root);
    aliasSnapshot.feeds[0].article_ids[0] = id;
    delete aliasSnapshot.feeds[0].matches[sha256("required")];
    aliasSnapshot.feeds[0].matches[id] = [];
    await writeFile(path.join(root, "snapshot.json"), JSON.stringify(aliasSnapshot));
    await assert.rejects(loadData(root), /Feed references an article alias/);
    const chain = await writeAliasFixture(root);
    for (const file of chain.article_files) {
      const shard: Shard = JSON.parse(await readFile(path.join(root, file.path), "utf8"));
      for (const article of shard.articles) {
        if (article.id === id) article.canonical_id = sha256("optional");
        if (article.id === sha256("optional")) {
          article.canonical_id = sha256("required");
          article.identity_keys = [];
        }
      }
      const bytes = JSON.stringify(shard);
      file.sha256 = sha256(bytes);
      await writeFile(path.join(root, file.path), bytes);
    }
    await writeFile(path.join(root, "snapshot.json"), JSON.stringify(chain));
    await assert.rejects(loadData(root), /existing canonical article/);
  } finally { await rm(root, { recursive: true }); }
});
