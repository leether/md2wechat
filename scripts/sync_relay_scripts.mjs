#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_ENV_PATH = path.join(REPO_ROOT, ".env");
const SSH_OPTIONS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];

export const RELAY_DEPLOYMENT_MANIFEST = Object.freeze([
  Object.freeze({ localPath: "scripts/create_wechat_draft.mjs", remotePath: "create_wechat_draft.mjs" }),
  Object.freeze({ localPath: "scripts/lib/memory-lib.mjs", remotePath: "lib/memory-lib.mjs" }),
]);

export const REQUIRED_ENTRY_FLAGS = Object.freeze([
  "--digest",
  "--source-path",
  "--audit-out",
  "--push-result-out",
  "--json",
]);

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function formatBackupTag(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

export function parseCliArgs(argv) {
  const result = {
    mode: "check",
    envPath: DEFAULT_ENV_PATH,
    remoteDir: "",
    backupTag: "",
    json: false,
    help: false,
  };
  let explicitMode = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check" || arg === "--apply") {
      const nextMode = arg.slice(2);
      if (explicitMode && explicitMode !== nextMode) {
        throw new Error("--check and --apply are mutually exclusive");
      }
      explicitMode = nextMode;
      result.mode = nextMode;
    } else if (arg === "--env" || arg === "--remote-dir" || arg === "--backup-tag") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--env") result.envPath = path.resolve(value);
      if (arg === "--remote-dir") result.remoteDir = value;
      if (arg === "--backup-tag") result.backupTag = value;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (result.backupTag && !/^[A-Za-z0-9._-]+$/.test(result.backupTag)) {
    throw new Error("--backup-tag may contain only letters, numbers, dot, underscore, and dash");
  }
  return result;
}

export function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function buildLocalManifest({ repoRoot = REPO_ROOT, manifest = RELAY_DEPLOYMENT_MANIFEST } = {}) {
  return manifest.map((entry) => {
    const absolutePath = path.resolve(repoRoot, entry.localPath);
    if (!fs.existsSync(absolutePath)) throw new Error(`manifest source missing: ${entry.localPath}`);
    return {
      ...entry,
      absolutePath,
      sha256: sha256File(absolutePath),
    };
  });
}

export function buildRemoteProbeCommand({ remoteDir, manifest = RELAY_DEPLOYMENT_MANIFEST, requiredFlags = REQUIRED_ENTRY_FLAGS }) {
  const lines = ["set -eu"];
  for (const entry of manifest) {
    const target = path.posix.join(remoteDir, entry.remotePath);
    lines.push(
      `if [ -f ${shellQuote(target)} ]; then ` +
        `remote_hash=$(sha256sum ${shellQuote(target)} | awk '{print $1}'); ` +
        `printf 'FILE\\t%s\\t%s\\n' ${shellQuote(entry.remotePath)} "$remote_hash"; ` +
        `if node --check ${shellQuote(target)} >/dev/null 2>&1; then ` +
          `printf 'SYNTAX\\t%s\\t1\\n' ${shellQuote(entry.remotePath)}; ` +
        `else printf 'SYNTAX\\t%s\\t0\\n' ${shellQuote(entry.remotePath)}; fi; ` +
      `else ` +
        `printf 'FILE\\t%s\\tMISSING\\n' ${shellQuote(entry.remotePath)}; ` +
        `printf 'SYNTAX\\t%s\\t0\\n' ${shellQuote(entry.remotePath)}; ` +
      `fi`,
    );
  }

  const entryTarget = path.posix.join(remoteDir, manifest[0].remotePath);
  lines.push(
    `if [ -f ${shellQuote(entryTarget)} ]; then ` +
      `help_output=$(node ${shellQuote(entryTarget)} --help 2>&1 || true); ` +
    `else help_output=''; fi`,
  );
  for (const flag of requiredFlags) {
    lines.push(
      `if printf '%s' "$help_output" | grep -Fq -- ${shellQuote(flag)}; then ` +
        `printf 'FLAG\\t%s\\t1\\n' ${shellQuote(flag)}; ` +
      `else printf 'FLAG\\t%s\\t0\\n' ${shellQuote(flag)}; fi`,
    );
  }
  return lines.join("; ");
}

export function parseRemoteProbeOutput(output) {
  const result = { files: {}, syntax: {}, flags: {} };
  for (const line of String(output || "").split(/\r?\n/)) {
    const [kind, name, value] = line.split("\t");
    if (kind === "FILE" && name) result.files[name] = value || "MISSING";
    if (kind === "SYNTAX" && name) result.syntax[name] = value === "1";
    if (kind === "FLAG" && name) result.flags[name] = value === "1";
  }
  return result;
}

export function evaluateRemoteProbe({ localManifest, remoteProbe, requiredFlags = REQUIRED_ENTRY_FLAGS }) {
  const files = localManifest.map((entry) => {
    const remoteSha256 = remoteProbe.files[entry.remotePath] || "";
    let status = "aligned";
    if (!remoteSha256 || remoteSha256 === "MISSING") status = "missing";
    else if (remoteSha256 !== entry.sha256) status = "drift";
    else if (!remoteProbe.syntax[entry.remotePath]) status = "syntax-invalid";
    return {
      local_path: entry.localPath,
      remote_path: entry.remotePath,
      local_sha256: entry.sha256,
      remote_sha256: remoteSha256 === "MISSING" ? "" : remoteSha256,
      syntax_ok: Boolean(remoteProbe.syntax[entry.remotePath]),
      status,
    };
  });
  const flags = requiredFlags.map((flag) => ({ flag, present: Boolean(remoteProbe.flags[flag]) }));
  return {
    ok: files.every((entry) => entry.status === "aligned") && flags.every((entry) => entry.present),
    files,
    flags,
  };
}

export function buildRemotePreparationCommand({ remoteDir, localManifest, backupTag }) {
  const directories = new Set([remoteDir]);
  for (const entry of localManifest) {
    directories.add(path.posix.dirname(path.posix.join(remoteDir, entry.remotePath)));
  }
  const stagingPaths = localManifest.map((entry) =>
    path.posix.join(remoteDir, `${entry.remotePath}.staged-${backupTag}`),
  );
  return {
    command: `mkdir -p ${[...directories].map(shellQuote).join(" ")} && rm -f ${stagingPaths.map(shellQuote).join(" ")}`,
    stagingPaths,
  };
}

export function buildRemoteUploadCommand(stagingPath) {
  return `cat > ${shellQuote(stagingPath)}`;
}

export function buildRemoteInstallCommand({
  remoteDir,
  localManifest,
  backupTag,
  requiredFlags = REQUIRED_ENTRY_FLAGS,
}) {
  const records = localManifest.map((entry) => {
    const target = path.posix.join(remoteDir, entry.remotePath);
    return {
      ...entry,
      target,
      backup: `${target}.bak-${backupTag}`,
      staging: `${target}.staged-${backupTag}`,
    };
  });
  const lines = ["set -u", "backup_ok=1"];

  for (const entry of records) {
    lines.push(`if [ -e ${shellQuote(entry.backup)} ]; then backup_ok=0; fi`);
  }
  lines.push("if [ \"$backup_ok\" -ne 1 ]; then exit 50; fi");
  for (const entry of records) {
    lines.push(
      `if [ -f ${shellQuote(entry.target)} ]; then ` +
        `cp -p ${shellQuote(entry.target)} ${shellQuote(entry.backup)} || backup_ok=0; ` +
      `fi`,
    );
  }
  lines.push(
    `if [ "$backup_ok" -ne 1 ]; then rm -f ${records.map((entry) => shellQuote(entry.staging)).join(" ")}; exit 50; fi`,
    "install_ok=1",
  );
  for (const entry of records) {
    lines.push(
      `mv ${shellQuote(entry.staging)} ${shellQuote(entry.target)} || install_ok=0`,
      `chmod 0644 ${shellQuote(entry.target)} || install_ok=0`,
      `test "$(sha256sum ${shellQuote(entry.target)} | awk '{print $1}')" = ${shellQuote(entry.sha256)} || install_ok=0`,
      `node --check ${shellQuote(entry.target)} >/dev/null 2>&1 || install_ok=0`,
    );
  }
  const entryTarget = records[0].target;
  lines.push(`help_output=$(node ${shellQuote(entryTarget)} --help 2>&1 || true)`);
  for (const flag of requiredFlags) {
    lines.push(`printf '%s' "$help_output" | grep -Fq -- ${shellQuote(flag)} || install_ok=0`);
  }
  lines.push("if [ \"$install_ok\" -ne 1 ]; then rollback_ok=1");
  for (const entry of records) {
    lines.push(
      `if [ -f ${shellQuote(entry.backup)} ]; then ` +
        `cp -p ${shellQuote(entry.backup)} ${shellQuote(entry.target)} || rollback_ok=0; ` +
      `else rm -f ${shellQuote(entry.target)} || rollback_ok=0; fi`,
    );
  }
  lines.push(
    `rm -f ${records.map((entry) => shellQuote(entry.staging)).join(" ")}`,
    "if [ \"$rollback_ok\" -eq 1 ]; then exit 51; else exit 52; fi",
    "fi",
    "printf 'APPLY\\tOK\\n'",
  );
  return lines.join("; ");
}

function runSsh({ relayHost, command, timeoutMs = 20000 }) {
  return spawnSync("ssh", [...SSH_OPTIONS, relayHost, command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
}

function uploadStagedFile({ relayHost, sourcePath, stagingPath, timeoutMs = 20000 }) {
  return spawnSync("ssh", [...SSH_OPTIONS, relayHost, buildRemoteUploadCommand(stagingPath)], {
    encoding: "utf8",
    input: fs.readFileSync(sourcePath),
    stdio: ["pipe", "pipe", "pipe"],
    timeout: timeoutMs,
  });
}

function runProbe({ relayHost, remoteDir, localManifest }) {
  const probe = runSsh({
    relayHost,
    command: buildRemoteProbeCommand({ remoteDir, manifest: localManifest }),
  });
  if (probe.status !== 0) {
    return {
      ok: false,
      transport_ok: false,
      transport_status: probe.status,
      files: [],
      flags: [],
    };
  }
  const evaluated = evaluateRemoteProbe({
    localManifest,
    remoteProbe: parseRemoteProbeOutput(probe.stdout),
  });
  return { ...evaluated, transport_ok: true, transport_status: 0 };
}

function resolveRuntimeConfig(args) {
  const env = readEnvFile(args.envPath);
  const relayHost = env.WECHAT_RELAY_HOST || "";
  const remoteDir = args.remoteDir || env.WECHAT_RELAY_SCRIPTS_DIR || "";
  if (!relayHost) throw new Error("WECHAT_RELAY_HOST is not configured");
  if (!remoteDir) throw new Error("WECHAT_RELAY_SCRIPTS_DIR is not configured");
  return { relayHost, remoteDir };
}

function publicCheckResult({ mode, remoteDir, probe, backupTag = "", applied = false }) {
  return {
    schema_version: "md2wechat-relay-deployment/v1",
    mode,
    ok: probe.ok,
    completion_status: probe.ok ? (applied ? "relay-scripts-deployed" : "relay-scripts-aligned") : "relay-scripts-drift",
    remote: {
      configured: true,
      scripts_dir: remoteDir,
      host_redacted: true,
      transport_ok: probe.transport_ok,
    },
    manifest: probe.files,
    required_flags: probe.flags,
    applied,
    backup_tag: backupTag,
  };
}

function printHelp() {
  console.log(`Usage: node scripts/sync_relay_scripts.mjs [--check | --apply] [options]

Default mode is --check and never mutates the relay.

Options:
  --check                 Compare local manifest hashes/flags with relay (default)
  --apply                 Stage, back up, promote, verify, and rollback on failure
  --env <path>            Env file containing WECHAT_RELAY_HOST and WECHAT_RELAY_SCRIPTS_DIR
  --remote-dir <path>     Override the configured relay scripts directory
  --backup-tag <tag>      Backup suffix for --apply (default: UTC timestamp)
  --json                  Emit structured JSON with the relay host redacted
  --help                  Show this help

Live --apply requires explicit operator approval. Routine article pushes only run --check.`);
}

function emit(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const label = result.ok ? "PASS" : "FAIL";
  console.log(`[relay-deployment] ${label}: ${result.completion_status}`);
  for (const entry of result.manifest || []) {
    console.log(`  ${entry.remote_path}: ${entry.status}`);
  }
  for (const entry of result.required_flags || []) {
    console.log(`  ${entry.flag}: ${entry.present ? "present" : "missing"}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseCliArgs(argv);
    if (args.help) {
      printHelp();
      return 0;
    }
    const { relayHost, remoteDir } = resolveRuntimeConfig(args);
    const localManifest = buildLocalManifest();
    const initialProbe = runProbe({ relayHost, remoteDir, localManifest });

    if (!initialProbe.transport_ok) throw new Error("relay read-only probe failed");

    if (args.mode === "check" || initialProbe.ok) {
      const result = publicCheckResult({ mode: args.mode, remoteDir, probe: initialProbe });
      emit(result, args.json);
      return result.ok ? 0 : 2;
    }

    const backupTag = args.backupTag || formatBackupTag();
    const preparation = buildRemotePreparationCommand({ remoteDir, localManifest, backupTag });
    const prepareResult = runSsh({ relayHost, command: preparation.command });
    if (prepareResult.status !== 0) throw new Error("relay staging preparation failed");

    for (let index = 0; index < localManifest.length; index += 1) {
      const entry = localManifest[index];
      const copy = uploadStagedFile({
        relayHost,
        sourcePath: entry.absolutePath,
        stagingPath: preparation.stagingPaths[index],
      });
      if (copy.status !== 0) {
        runSsh({
          relayHost,
          command: `rm -f ${preparation.stagingPaths.map(shellQuote).join(" ")}`,
        });
        throw new Error("relay staging copy failed");
      }
    }

    const install = runSsh({
      relayHost,
      command: buildRemoteInstallCommand({ remoteDir, localManifest, backupTag }),
    });
    if (install.status !== 0) {
      throw new Error(install.status === 51 ? "relay install failed and rollback completed" : "relay install or rollback failed");
    }

    const finalProbe = runProbe({ relayHost, remoteDir, localManifest });
    const result = publicCheckResult({
      mode: "apply",
      remoteDir,
      probe: finalProbe,
      backupTag,
      applied: true,
    });
    emit(result, args.json);
    return result.ok ? 0 : 4;
  } catch (error) {
    const result = {
      schema_version: "md2wechat-relay-deployment/v1",
      mode: args?.mode || "check",
      ok: false,
      completion_status: "relay-deployment-error",
      error: error.message,
      remote: { host_redacted: true },
    };
    emit(result, Boolean(args?.json));
    return 3;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  process.exitCode = main();
}
