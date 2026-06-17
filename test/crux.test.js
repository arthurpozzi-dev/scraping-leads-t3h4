import { test } from "node:test";
import assert from "node:assert/strict";
import { CruxClient } from "../src/infrastructure/pagespeed/CruxClient.js";

const sample = {
  record: {
    metrics: {
      largest_contentful_paint: { percentiles: { p75: 2200 }, histogram: [{}] },
      interaction_to_next_paint: { percentiles: { p75: 180 } },
      cumulative_layout_shift: { percentiles: { p75: 0.05 } },
    },
    key: {},
  },
};

test("crux query maps field metrics + derives score", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => sample });
  const c = new CruxClient({ apiKey: "k", fetchImpl: fakeFetch });
  const r = await c.query("https://x.com");
  assert.equal(r.hasField, true);
  assert.equal(r.lcp.p75, 2200);
  assert.equal(r.lcp.category, "good"); // <2500
  assert.equal(r.cls.category, "good"); // <0.1
  assert.equal(typeof r.score, "number");
  assert.equal(r.score, 100); // all three core metrics good
});

test("crux returns hasField:false on 404 (no sample)", async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, json: async () => ({ error: {} }) });
  const c = new CruxClient({ apiKey: "k", fetchImpl: fakeFetch });
  const r = await c.query("https://no-traffic.com");
  assert.equal(r.hasField, false);
  assert.equal(r.score, null);
});

test("crux penalizes non-good core metrics", async () => {
  const slow = {
    record: {
      metrics: {
        largest_contentful_paint: { percentiles: { p75: 5000 } }, // poor
        cumulative_layout_shift: { percentiles: { p75: 0.3 } }, // poor
      },
      key: {},
    },
  };
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => slow });
  const c = new CruxClient({ apiKey: "k", fetchImpl: fakeFetch });
  const r = await c.query("https://slow.com");
  assert.equal(r.lcp.category, "poor");
  assert.equal(r.cls.category, "poor");
  assert.equal(r.score, 50); // 100 - 25 (lcp) - 25 (cls); inp absent
});
