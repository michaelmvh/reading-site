import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validateCounts, validateSite } from "../scripts/validate.ts";

test("coverage checks reject missing feeds and excessive drops", () => {
  assert.throws(() => validateCounts({}, { default: 100 }, false), /disappeared/);
  assert.throws(() => validateCounts({ default: 59 }, { default: 100 }, false), /40%/);
  validateCounts({ default: 60 }, { default: 100 }, false);
  validateCounts({ default: 1 }, { default: 100 }, true);
});

test("partial snapshots and unexpected files cannot deploy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reading-validation-"));
  try {
    await assert.rejects(validateSite(root), /Missing generated file/);
    await writeFile(path.join(root, ".env"), "EXAMPLE=not-a-secret");
    await assert.rejects(validateSite(root), /Unexpected output file/);
  } finally { await rm(root, { recursive: true }); }
});

test("symlinks cannot escape the output allowlist", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reading-links-"));
  try {
    await mkdir(path.join(root, "data"));
    await symlink("../missing", path.join(root, "data", "archive.json"));
    await assert.rejects(validateSite(root), /Links are not allowed/);
  } finally { await rm(root, { recursive: true }); }
});
