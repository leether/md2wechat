#!/usr/bin/env node
import assert from "node:assert/strict";
import { generateCheck } from "./code-generator.mjs";

const generated = generateCheck({
  id: "f_contract",
  category: "测试",
  description: "正文不得超过 12 字",
  resolution: "进入观察层后人工审查",
  rule_id: "contract_chars",
});

assert.equal(generated.ruleId, "contract_chars");
assert.equal(generated.register.enforcement, "observe");
assert.equal(generated.register.block_on_fail, false);
assert.equal(generated.register.isolation, true);
assert.equal(generated.testFileName, "contract_chars.test.mjs");
assert.match(generated.testCode, /assert\.equal/);
assert.match(generated.testCode, /OBSERVATION/);
assert.match(generated.code, /enforcement: "observe"/);

console.log("Code generator contract passed.");
