import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichLeads } from "../src/application/EnrichLeads.js";

const makePs = (counter) => ({
  analyze: async () => {
    counter.n++;
    return {
      score: 40,
      categories: { accessibility: null, bestPractices: null, seo: null },
      metrics: { lcp: { display: "4 s" }, fcp: {}, cls: {}, tbt: {}, si: {}, tti: {} },
      field: null,
      opportunities: [],
    };
  },
});

test("CrUX hit fills score and skips Lighthouse; miss falls back to PageSpeed", async () => {
  const crux = {
    query: async (u) =>
      u.includes("a.com")
        ? { hasField: true, overall: "FAST", score: 95, lcp: { p75: 2000, category: "good" }, inp: null, cls: { p75: 0.02, category: "good" }, fcp: null, ttfb: null }
        : { hasField: false, score: null, lcp: null, inp: null, cls: null, fcp: null, ttfb: null, overall: null },
  };
  const counter = { n: 0 };
  const leads = [
    { nome: "A", site: "https://a.com" },
    { nome: "B", site: "https://b.com" },
  ];
  const out = await enrichLeads(leads, makePs(counter), undefined, { cruxClient: crux });
  assert.equal(counter.n, 1); // only B hit PageSpeed
  const a = out.leads.find((l) => l.nome === "A");
  assert.equal(a.cwv_score, 95);
  assert.equal(a.cwv_campo, "FAST");
  assert.equal(a.cwv_report, null); // fast path: no full report
  assert.equal(a.score_seo, ""); // not measured in fast mode -> empty string, never undefined
  const b = out.leads.find((l) => l.nome === "B");
  assert.equal(b.cwv_score, 40);
  assert.equal(out.ok, 2);
});

test("deep mode bypasses CrUX and always runs Lighthouse", async () => {
  const crux = { query: async () => { throw new Error("should not be called in deep mode"); } };
  const counter = { n: 0 };
  const leads = [{ nome: "A", site: "https://a.com" }];
  const out = await enrichLeads(leads, makePs(counter), undefined, { cruxClient: crux, deep: true });
  assert.equal(counter.n, 1);
  assert.equal(out.leads[0].cwv_score, 40);
});
