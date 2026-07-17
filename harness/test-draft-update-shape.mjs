import assert from "node:assert/strict";
import { applyDraftUpdateShape } from "../scripts/create_wechat_draft.mjs";

// draft/update requires `articles` as a single article object, while
// draft/add uses an array. Reusing the array shape yields WeChat errcode
// 47001 (data format error) -- verified live on 2026-07-17 against the
// XINZHE account (array -> 47001, object -> ok).

const payload = { articles: [{ title: "T", author: "A", content: "<p>x</p>" }] };
const shaped = applyDraftUpdateShape(payload, "MID123", "2");
assert.equal(shaped, payload, "returns the same payload for convenience");
assert.equal(payload.media_id, "MID123");
assert.equal(payload.index, 2);
assert.equal(Array.isArray(payload.articles), false, "articles must become a single object");
assert.equal(payload.articles.title, "T");
assert.equal(payload.articles.author, "A");

// Already-object payloads pass through untouched.
const already = { articles: { title: "T2" } };
applyDraftUpdateShape(already, "MID9", "0");
assert.equal(already.articles.title, "T2");
assert.equal(already.index, 0);

// Missing or invalid index falls back to 0.
const fallback = { articles: [{ title: "T3" }] };
applyDraftUpdateShape(fallback, "MID5", "not-a-number");
assert.equal(fallback.index, 0);

// Call-site contract: callers pass a shallow copy so downstream bookkeeping
// (push-result, audit) keeps reading plan.payload.articles[0] as an array.
const src = { articles: [{ title: "T4" }] };
applyDraftUpdateShape({ ...src }, "MID7", "0");
assert.equal(Array.isArray(src.articles), true, "original payload keeps array shape");

console.log("test-draft-update-shape: ok");
