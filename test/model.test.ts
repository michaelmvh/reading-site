import assert from "node:assert/strict";
import test from "node:test";
import { matches, readState, safeReturn, writeState } from "../src/client/model.ts";
const options = { authors: ["required", "optional"], sources: ["core", "curated:example"] };
const article = { date: "2026-10-01", defaultAuthor: false, authors: ["optional"], sources: ["curated:example"] };
const state = (query = "") => readState(new URLSearchParams(query), options);

test("default/all/custom/empty selections, source OR, and UTC date boundaries are distinct", () => {
  assert.equal(matches(article, state()), false);
  assert.equal(matches(article, state("authors=all")), true);
  assert.equal(matches(article, state("authors=custom")), false);
  assert.equal(matches(article, state("authors=custom&author=optional")), true);
  assert.equal(matches(article, state("authors=all&source=core")), false);
  assert.equal(matches(article, state("authors=all&source=core&source=curated%3Aexample")), true);
  const now = new Date("2026-10-31T23:59:59Z");
  assert.equal(matches(article, state("authors=all&period=30d"), now), true);
  assert.equal(matches({ ...article, date: "" }, state("authors=all&period=30d"), now), false);
  assert.equal(matches({ ...article, date: "2026-02-30" }, state("authors=all&period=1y"), now), false);
});

test("URL state round-trips without silently accepting stale filters or external return links", () => {
  for (const query of ["", "authors=all", "authors=custom", "authors=custom&author=optional&source=core&period=1y"]) {
    const first = state(query);
    assert.deepEqual(readState(writeState(first, options), options), first);
  }
  for (const query of ["rss", "period=10y", "authors=bad", "author=unknown", "source=unknown", "authors=all&authors=custom"]) assert.throws(() => state(query));
  assert.equal(safeReturn("/preview/feeds/example/?authors=all", "/preview/", "https://example.org"), "/preview/feeds/example/?authors=all");
  for (const value of ["https://evil.org/", "//evil.org/", "/preview/article/id/", "/other/"]) assert.equal(safeReturn(value, "/preview/", "https://example.org"), null);
});
