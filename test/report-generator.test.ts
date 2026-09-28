import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateHtmlReport } from "../src/lib/report-generator.js";
import type { Leak } from "../src/types.js";

test("generateHtmlReport writes a no-leaks page when given an empty array", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-report-test-"));
  const reportPath = path.join(tmpDir, "report.html");
  try {
    generateHtmlReport([], reportPath);
    const html = fs.readFileSync(reportPath, "utf8");
    assert.match(html, /No secrets detected/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("generateHtmlReport escapes leak data to prevent HTML injection", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-report-test-"));
  const reportPath = path.join(tmpDir, "report.html");
  const leaks: Leak[] = [
    {
      File: "<script>alert(1)</script>.js",
      StartLine: 10,
      RuleID: "aws-key",
      Description: "AWS Key <b>found</b>",
      Fingerprint: "abc123",
    },
  ];
  try {
    generateHtmlReport(leaks, reportPath);
    const html = fs.readFileSync(reportPath, "utf8");
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
