#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RELAY_DEPLOYMENT_MANIFEST,
  REQUIRED_ENTRY_FLAGS,
  buildLocalManifest,
  buildRemoteInstallCommand,
  buildRemotePreparationCommand,
  buildRemoteProbeCommand,
  buildRemoteUploadCommand,
  evaluateRemoteProbe,
  parseCliArgs,
  parseRemoteProbeOutput,
} from "../scripts/sync_relay_scripts.mjs";

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(harnessDir, "..");

assert.equal(parseCliArgs([]).mode, "check");
assert.equal(parseCliArgs(["--check", "--json"]).json, true);
assert.equal(parseCliArgs(["--apply", "--backup-tag", "proof-tag"]).mode, "apply");
assert.throws(() => parseCliArgs(["--check", "--apply"]), /mutually exclusive/);
assert.throws(() => parseCliArgs(["--apply", "--backup-tag", "unsafe tag"]), /backup-tag/);

const localManifest = buildLocalManifest({ repoRoot });
assert.equal(localManifest.length, RELAY_DEPLOYMENT_MANIFEST.length);
assert.ok(localManifest.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));

const entrySourcePath = path.join(repoRoot, RELAY_DEPLOYMENT_MANIFEST[0].localPath);
const entrySource = fs.readFileSync(entrySourcePath, "utf8");
const localImports = [...entrySource.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((match) =>
  path.relative(repoRoot, path.resolve(path.dirname(entrySourcePath), match[1])),
);
for (const importedPath of localImports) {
  assert.ok(
    RELAY_DEPLOYMENT_MANIFEST.some((entry) => entry.localPath === importedPath),
    `relay manifest must include local import: ${importedPath}`,
  );
}

const probeCommand = buildRemoteProbeCommand({
  remoteDir: "/relay/shared/scripts",
  manifest: localManifest,
});
assert.match(probeCommand, /create_wechat_draft\.mjs/);
assert.match(probeCommand, /lib\/memory-lib\.mjs/);
for (const flag of REQUIRED_ENTRY_FLAGS) assert.ok(probeCommand.includes(flag));
assert.match(probeCommand, /node --check/);

const alignedOutput = [
  ...localManifest.flatMap((entry) => [
    `FILE\t${entry.remotePath}\t${entry.sha256}`,
    `SYNTAX\t${entry.remotePath}\t1`,
  ]),
  ...REQUIRED_ENTRY_FLAGS.map((flag) => `FLAG\t${flag}\t1`),
].join("\n");
const aligned = evaluateRemoteProbe({
  localManifest,
  remoteProbe: parseRemoteProbeOutput(alignedOutput),
});
assert.equal(aligned.ok, true);
assert.ok(aligned.files.every((entry) => entry.status === "aligned"));

const driftedOutput = alignedOutput.replace(localManifest[0].sha256, "0".repeat(64));
const drifted = evaluateRemoteProbe({
  localManifest,
  remoteProbe: parseRemoteProbeOutput(driftedOutput),
});
assert.equal(drifted.ok, false);
assert.equal(drifted.files[0].status, "drift");

const missingFlagOutput = alignedOutput.replace("FLAG\t--audit-out\t1", "FLAG\t--audit-out\t0");
assert.equal(
  evaluateRemoteProbe({
    localManifest,
    remoteProbe: parseRemoteProbeOutput(missingFlagOutput),
  }).ok,
  false,
);

const preparation = buildRemotePreparationCommand({
  remoteDir: "/relay/shared/scripts",
  localManifest,
  backupTag: "proof-tag",
});
assert.equal(preparation.stagingPaths.length, localManifest.length);
assert.match(preparation.command, /mkdir -p/);
assert.match(preparation.command, /\.staged-proof-tag/);
assert.equal(
  buildRemoteUploadCommand("/relay/shared scripts/writer.staged-proof-tag"),
  "cat > '/relay/shared scripts/writer.staged-proof-tag'",
);

const installCommand = buildRemoteInstallCommand({
  remoteDir: "/relay/shared/scripts",
  localManifest,
  backupTag: "proof-tag",
});
assert.match(installCommand, /\.bak-proof-tag/);
assert.match(installCommand, /\.staged-proof-tag/);
assert.match(installCommand, /cp -p/);
assert.match(installCommand, /mv /);
assert.match(installCommand, /rollback_ok/);
assert.match(installCommand, /exit 51/);
assert.match(installCommand, /exit 52/);
for (const entry of localManifest) assert.ok(installCommand.includes(entry.sha256));
for (const flag of REQUIRED_ENTRY_FLAGS) assert.ok(installCommand.includes(flag));

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeInstallFixture(root, { tag, entryContent, dependencyContent }) {
  const entryTarget = path.join(root, "create_wechat_draft.mjs");
  const dependencyTarget = path.join(root, "lib", "memory-lib.mjs");
  fs.mkdirSync(path.dirname(dependencyTarget), { recursive: true });
  fs.writeFileSync(entryTarget, "console.log('old entry');\n", "utf8");
  fs.writeFileSync(dependencyTarget, "export const oldDependency = true;\n", "utf8");
  fs.writeFileSync(`${entryTarget}.staged-${tag}`, entryContent, "utf8");
  fs.writeFileSync(`${dependencyTarget}.staged-${tag}`, dependencyContent, "utf8");
  return {
    manifest: [
      {
        localPath: "scripts/create_wechat_draft.mjs",
        remotePath: "create_wechat_draft.mjs",
        sha256: sha256Text(entryContent),
      },
      {
        localPath: "scripts/lib/memory-lib.mjs",
        remotePath: "lib/memory-lib.mjs",
        sha256: sha256Text(dependencyContent),
      },
    ],
    entryTarget,
    dependencyTarget,
  };
}

const installTmp = fs.mkdtempSync(path.join(os.tmpdir(), "md2wechat-relay-install-"));
try {
  const requiredFlag = "--required-flag";
  const successTag = "success-tag";
  const successEntry = `if (process.argv.includes("--help")) console.log("${requiredFlag}");\n`;
  const successDependency = "export const deployedDependency = true;\n";
  const success = writeInstallFixture(installTmp, {
    tag: successTag,
    entryContent: successEntry,
    dependencyContent: successDependency,
  });
  const successCommand = buildRemoteInstallCommand({
    remoteDir: installTmp,
    localManifest: success.manifest,
    backupTag: successTag,
    requiredFlags: [requiredFlag],
  });
  const successRun = spawnSync("sh", ["-c", successCommand], { encoding: "utf8" });
  assert.equal(successRun.status, 0, successRun.stderr);
  assert.equal(fs.readFileSync(success.entryTarget, "utf8"), successEntry);
  assert.equal(fs.readFileSync(success.dependencyTarget, "utf8"), successDependency);
  assert.equal(fs.readFileSync(`${success.entryTarget}.bak-${successTag}`, "utf8"), "console.log('old entry');\n");

  const rollbackRoot = path.join(installTmp, "rollback fixture");
  const rollbackTag = "rollback-tag";
  const badEntry = "console.log('help without required flag');\n";
  const rollback = writeInstallFixture(rollbackRoot, {
    tag: rollbackTag,
    entryContent: badEntry,
    dependencyContent: successDependency,
  });
  const rollbackCommand = buildRemoteInstallCommand({
    remoteDir: rollbackRoot,
    localManifest: rollback.manifest,
    backupTag: rollbackTag,
    requiredFlags: [requiredFlag],
  });
  const rollbackRun = spawnSync("sh", ["-c", rollbackCommand], { encoding: "utf8" });
  assert.equal(rollbackRun.status, 51, rollbackRun.stderr);
  assert.equal(fs.readFileSync(rollback.entryTarget, "utf8"), "console.log('old entry');\n");
  assert.equal(fs.readFileSync(rollback.dependencyTarget, "utf8"), "export const oldDependency = true;\n");
} finally {
  fs.rmSync(installTmp, { recursive: true, force: true });
}

console.log("Relay script sync contract passed.");
