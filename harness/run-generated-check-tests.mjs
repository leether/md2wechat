#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.join(__dirname, "preflight-checks", "__tests__");

async function main() {
  if (!fs.existsSync(testsDir)) {
    console.log("No generated check tests found.");
    return 0;
  }

  const testFiles = fs.readdirSync(testsDir)
    .filter((file) => file.endsWith(".test.mjs"))
    .sort()
    .map((file) => path.join(testsDir, file));

  if (testFiles.length === 0) {
    console.log("No generated check tests found.");
    return 0;
  }

  for (const file of testFiles) {
    await import(pathToFileURL(file).href);
    console.log(`PASS ${path.relative(process.cwd(), file)}`);
  }

  console.log(`Generated check tests passed: ${testFiles.length}`);
  return 0;
}

main().then((code) => {
  process.exitCode = code ?? 0;
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
