import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/lib/config.js";

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(original);
  }
}

async function withArgv<T>(args: string[], fn: () => Promise<T>): Promise<T> {
  const original = process.argv;
  process.argv = [...original.slice(0, 2), ...args];
  try {
    return await fn();
  } finally {
    process.argv = original;
  }
}

test("loadConfig defaults to staged diff mode", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-config-test-"));
  try {
    await withCwd(tmpDir, () =>
      withArgv([], async () => {
        const config = await loadConfig();
        assert.equal(config.diffMode, "staged");
        assert.deepEqual(config.additionalArgs, []);
      })
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadConfig parses --diff-mode and --depth flags", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-config-test-"));
  try {
    await withCwd(tmpDir, () =>
      withArgv(["--diff-mode", "history", "--depth", "5"], async () => {
        const config = await loadConfig();
        assert.equal(config.diffMode, "history");
        assert.equal(config.scanDepth, 5);
      })
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadConfig falls back to 'staged' for an invalid diff mode", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-config-test-"));
  try {
    await withCwd(tmpDir, () =>
      withArgv(["--diff-mode", "bogus"], async () => {
        const config = await loadConfig();
        assert.equal(config.diffMode, "staged");
      })
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadConfig filters CLI-only flags out of additionalArgs", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-config-test-"));
  try {
    await withCwd(tmpDir, () =>
      withArgv(["--setup-husky", "--command", "npm run scan", "-v"], async () => {
        const config = await loadConfig();
        assert.deepEqual(config.additionalArgs, ["-v"]);
      })
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
