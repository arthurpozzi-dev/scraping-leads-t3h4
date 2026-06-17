import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureFullReport } from "../src/application/ensureFullReport.js";

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
