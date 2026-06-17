import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureFullReport } from "../src/application/ensureFullReport.js";
import { createJobCache } from "../src/application/jobCache.js";

test("returns existing report without calling analyze", async () => {
  let calls = 0;
  const ps = { analyze: async () => { calls++; return { score: 1 }; } };
  const lead = { site: "https://x.com", cwv_report: { score: 88 } };
  const r = await ensureFullReport(lead, ps);
  assert.equal(calls, 0);
  assert.equal(r.score, 88);
});

test("runs analyze once and caches on the lead when report missing", async () => {
  let calls = 0;
  const ps = { analyze: async () => { calls++; return { score: 73, categories: { seo: 90 } }; } };
  const lead = { site: "https://x.com", cwv_report: null };
  const r = await ensureFullReport(lead, ps);
  assert.equal(calls, 1);
  assert.equal(r.score, 73);
  assert.equal(lead.cwv_report.categories.seo, 90); // cached back onto the lead
});

test("returns null when no site and no report", async () => {
  let calls = 0;
  const ps = { analyze: async () => { calls++; return {}; } };
  const lead = { site: "", cwv_report: null };
  const r = await ensureFullReport(lead, ps);
  assert.equal(calls, 0);
  assert.equal(r, null);
});

test("cwvCache dedupes the deep report across leads on the same domain", async () => {
  let calls = 0;
  const ps = { analyze: async () => { calls++; return { score: 70 }; } };
  const cache = createJobCache();
  const a = { site: "https://shared.com", cwv_report: null };
  const b = { site: "https://shared.com/", cwv_report: null };
  const ra = await ensureFullReport(a, ps, cache.cwv);
  const rb = await ensureFullReport(b, ps, cache.cwv);
  assert.equal(calls, 1);
  assert.equal(ra.score, 70);
  assert.equal(rb.score, 70);
});
