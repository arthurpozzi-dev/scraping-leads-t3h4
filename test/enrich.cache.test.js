// test/enrich.cache.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichLeads } from "../src/application/EnrichLeads.js";
import { createJobCache } from "../src/application/jobCache.js";

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

test("cwvCache analyzes a shared domain once but maps both leads", async () => {
  const crux = { query: async () => ({ hasField: false, score: null, lcp: null, inp: null, cls: null, fcp: null, ttfb: null, overall: null }) };
  const counter = { n: 0 };
  const cache = createJobCache();
  const leads = [
    { nome: "A", site: "https://shared.com" },
    { nome: "B", site: "https://shared.com/" },
  ];
  const out = await enrichLeads(leads, makePs(counter), undefined, { cruxClient: crux, cwvCache: cache.cwv });
  assert.equal(counter.n, 1); // network once for the shared domain
  assert.equal(out.ok, 2);    // both leads mapped as OK
  assert.equal(out.leads[0].cwv_score, 40);
  assert.equal(out.leads[1].cwv_score, 40);
});
