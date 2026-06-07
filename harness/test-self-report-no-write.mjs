#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "md2wechat-self-report-"));
const logPath = path.join(tmp, "pipeline.jsonl");
const lessonsPath = path.join(tmp, "LESSONS_LEARNED.md");
const rulesPath = path.join(tmp, "push_rules.json");

const lessonsBefore = `---
autopoiesis: true
friction_points: []
---

# Test Lessons
`;
const rulesBefore = JSON.stringify({
  l1_mandatory_checks: {},
  l2_warning_checks: {},
  observation_checks: {},
  autopoiesis: {},
}, null, 2);

fs.writeFileSync(lessonsPath, lessonsBefore, "utf8");
fs.writeFileSync(rulesPath, rulesBefore, "utf8");
fs.writeFileSync(logPath, JSON.stringify({
  t: new Date().toISOString(),
  step: "preflight",
  status: "failed",
  script: "preflight",
  stdout_preview: "{\"id\":\"digest_length\"}",
}) + "\n", "utf8");

const stdout = execFileSync(process.execPath, [
  "harness/self_report.mjs",
  "--analyze-log", logPath,
  "--rules-path", rulesPath,
  "--lessons-path", lessonsPath,
  "--write-lessons",
  "--no-write",
], { encoding: "utf8" });

assert.match(stdout, /Auto-captured/);
assert.match(stdout, /skipped because --no-write is set/);
assert.equal(fs.readFileSync(lessonsPath, "utf8"), lessonsBefore);
assert.equal(fs.readFileSync(rulesPath, "utf8"), rulesBefore);

console.log("Self-report no-write contract passed.");
