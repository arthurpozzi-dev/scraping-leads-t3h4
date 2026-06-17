# Lighthouse self-hosted + enrichment dedup/cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user point Core Web Vitals lab analysis at a self-hosted, PageSpeed-compatible Lighthouse instance, and add a transparent per-job cache that deduplicates site fetches, web searches, and CWV analyses during enrichment.

**Architecture:** A new `jobCache` module provides promise-memoizers (page/search/cwv) stored on the in-memory job in the server's `store`, so they persist across the `/api/enrich`, `/api/emails`, `/api/socials` and `/api/report` routes. `PageSpeedClient` gains an optional `baseUrl` and its parser accepts both the PageSpeed v5 envelope and a raw `lhr`. `buildEnrichClients` forwards a `lighthouseUrl` as that `baseUrl`. CrUX stays first in fast mode; only the slow lab call is redirected to the self-hosted instance.

**Tech Stack:** Node.js (ESM), native `node:test` runner, Express + SSE. No new dependencies.

## Global Constraints

- ESM only (`"type": "module"`); use `import`/`export`, `.js` extensions in imports.
- Tests run with `npm test` (`node --test`); assertions via `node:assert/strict`.
- No new npm dependencies.
- Behavior MUST be identical when `lighthouseUrl` is empty AND there are no repeated domains/queries. Every new option is optional with a direct-call fallback.
- Cache scope is one job (in-memory); no cross-job/disk persistence.
- Comments and UI copy in Portuguese, matching the surrounding code style.

---

### Task 1: jobCache module (foundation)

**Files:**
- Create: `src/application/jobCache.js`
- Test: `test/jobCache.test.js`

**Interfaces:**
- Produces:
  - `cacheKey(url: string) => string` — normalized URL key (protocol forced, host lowercased, no trailing slash, no hash).
  - `createJobCache() => { page: Memo, search: Memo, cwv: Memo }`
  - `Memo.run(key: string, factory: () => Promise<T>) => Promise<T>` — returns the in-flight promise for `key` if present; otherwise calls `factory()`, caches the promise, and deletes the entry on rejection (success stays cached for the job's life).

- [ ] **Step 1: Write the failing test**

```js
// test/jobCache.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobCache, cacheKey } from "../src/application/jobCache.js";

test("cacheKey normalizes protocol, host case and trailing slash", () => {
  assert.equal(cacheKey("EXAMPLE.com/"), "https://example.com");
  assert.equal(cacheKey("https://Example.com/path/#frag"), "https://example.com/path");
  assert.equal(cacheKey(""), "");
});

test("run memoizes the resolved promise per key (factory runs once)", async () => {
  const cache = createJobCache();
  let calls = 0;
  const factory = async () => { calls++; return "v"; };
  const a = await cache.page.run("k", factory);
  const b = await cache.page.run("k", factory);
  assert.equal(a, "v");
  assert.equal(b, "v");
  assert.equal(calls, 1);
});

test("run shares a single in-flight promise for concurrent callers", async () => {
  const cache = createJobCache();
  let calls = 0;
  const factory = () => { calls++; return new Promise((r) => setTimeout(() => r("x"), 10)); };
  const [a, b] = await Promise.all([cache.cwv.run("k", factory), cache.cwv.run("k", factory)]);
  assert.equal(a, "x");
  assert.equal(b, "x");
  assert.equal(calls, 1);
});

test("rejection clears the entry so a later call retries", async () => {
  const cache = createJobCache();
  let calls = 0;
  const factory = async () => { calls++; if (calls === 1) throw new Error("boom"); return "ok"; };
  await assert.rejects(() => cache.search.run("k", factory), /boom/);
  const v = await cache.search.run("k", factory);
  assert.equal(v, "ok");
  assert.equal(calls, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/jobCache.test.js` (or `node --test test/jobCache.test.js`)
Expected: FAIL — `Cannot find module '../src/application/jobCache.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/application/jobCache.js
/**
 * Cache/dedup POR JOB do enriquecimento. Cada memoizador guarda a PROMESSA em voo
 * por chave (não só o valor resolvido), de modo que leads concorrentes que batem
 * na mesma chave compartilham a MESMA operação de rede. Rejeição limpa a entrada
 * (falha não fica cacheada); sucesso permanece pelo tempo de vida do job.
 *
 * Escopo: um job (uma execução). Vive no store do servidor e some com o job.
 */

/** Normaliza uma URL para servir de chave: protocolo, host minúsculo, sem barra/fragmento final. */
export function cacheKey(url) {
  const raw = (url || "").trim();
  if (!raw) return "";
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    const s = u.toString();
    return s.endsWith("/") ? s.slice(0, -1) : s;
  } catch {
    return raw.toLowerCase();
  }
}

/** Um memoizador de promessas por chave. */
function createMemo() {
  const inflight = new Map();
  return {
    run(key, factory) {
      const k = key || "";
      if (inflight.has(k)) return inflight.get(k);
      const p = Promise.resolve().then(factory).catch((e) => {
        inflight.delete(k);
        throw e;
      });
      inflight.set(k, p);
      return p;
    },
  };
}

/** Cria o cache de um job com os três namespaces usados no enriquecimento. */
export function createJobCache() {
  return { page: createMemo(), search: createMemo(), cwv: createMemo() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/jobCache.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/jobCache.js test/jobCache.test.js
git commit -m "feat(enrich): add per-job promise-memo cache (jobCache)"
```

---

### Task 2: PageSpeed `baseUrl` + dual-format parser

**Files:**
- Modify: `src/infrastructure/pagespeed/PageSpeedClient.js:17` (endpoint), `:46-51` (buildReport), `:113-131` (constructor + `_attempt`)
- Test: `test/pagespeed.baseurl.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `new PageSpeedClient({ baseUrl })` sends requests to `baseUrl` instead of the Google endpoint; `analyze()` parses a response body that is EITHER `{ lighthouseResult: <lhr>, loadingExperience? }` OR a bare `lhr` (`{ categories, audits, ... }`).

- [ ] **Step 1: Write the failing test**

```js
// test/pagespeed.baseurl.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PageSpeedClient } from "../src/infrastructure/pagespeed/PageSpeedClient.js";

const respond = (cap, body) => async (u) => {
  cap.url = u;
  return { ok: true, status: 200, json: async () => body };
};

test("baseUrl redirects the request to the self-hosted instance", async () => {
  const cap = {};
  const body = { lighthouseResult: { categories: { performance: { score: 0.8 } }, audits: {}, fetchTime: "t" } };
  const c = new PageSpeedClient({ baseUrl: "https://lh.local/run", fetchImpl: respond(cap, body) });
  const r = await c.analyze("https://x.com");
  assert.ok(cap.url.startsWith("https://lh.local/run?"), `unexpected url: ${cap.url}`);
  assert.equal(r.score, 80);
});

test("parses a bare lhr body (no PageSpeed envelope)", async () => {
  const cap = {};
  const lhr = {
    categories: { performance: { score: 0.55 }, seo: { score: 0.9 } },
    audits: { "largest-contentful-paint": { displayValue: "2.0 s", numericValue: 2000, score: 0.9 } },
    fetchTime: "t",
  };
  const c = new PageSpeedClient({ baseUrl: "https://lh.local/run", fetchImpl: respond(cap, lhr) });
  const r = await c.analyze("https://x.com");
  assert.equal(r.score, 55);
  assert.equal(r.categories.seo, 90);
  assert.equal(r.metrics.lcp.display, "2.0 s");
  assert.equal(r.field, null); // sem loadingExperience no lhr cru
});

test("default endpoint is still used when no baseUrl", async () => {
  const cap = {};
  const body = { lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {}, fetchTime: "t" }, loadingExperience: {} };
  const c = new PageSpeedClient({ apiKey: "k", fetchImpl: respond(cap, body) });
  await c.analyze("https://x.com");
  assert.ok(cap.url.startsWith("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?"), `unexpected url: ${cap.url}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/pagespeed.baseurl.test.js`
Expected: FAIL — `baseUrl` ignored (request still goes to googleapis), and/or bare-lhr parse yields `score === null` → throws "Resposta sem score".

- [ ] **Step 3: Write minimal implementation**

In `src/infrastructure/pagespeed/PageSpeedClient.js`, change the `buildReport` first lines (currently `:46-51`):

```js
function buildReport(data) {
  // Aceita o envelope do PageSpeed v5 ({ lighthouseResult }) OU o lhr cru no topo
  // (instâncias self-hosted que devolvem o Lighthouse Result direto).
  const lh = data.lighthouseResult || data || {};
  const cat = lh.categories || {};
  const audits = lh.audits || {};
  const le = data.loadingExperience || {};
  const fieldMetrics = le.metrics || {};
```

Change the constructor signature (currently `:113`) to accept `baseUrl`:

```js
  constructor({ apiKey, baseUrl, strategy = "mobile", timeoutMs = 45000, maxRetries = 1, categories = ["performance"], fetchImpl } = {}) {
    this.apiKey = apiKey || process.env.PAGESPEED_API_KEY || "";
    this.baseUrl = baseUrl || "";
    this.strategy = strategy;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.categories = categories;
    this._fetch = fetchImpl || globalThis.fetch;
  }
```

In `_attempt` (currently `:131`), build the request against `this.baseUrl || ENDPOINT`:

```js
    const endpoint = this.baseUrl || ENDPOINT;
    const res = await this._fetch(`${endpoint}?${params}`, { signal: controller.signal });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/pagespeed.baseurl.test.js test/pagespeed.categories.test.js`
Expected: PASS (new file 3 tests + existing categories tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/pagespeed/PageSpeedClient.js test/pagespeed.baseurl.test.js
git commit -m "feat(cwv): PageSpeedClient accepts baseUrl and bare-lhr responses"
```

---

### Task 3: `buildEnrichClients` forwards `lighthouseUrl`

**Files:**
- Modify: `src/infrastructure/http/enrichClients.js:14-24`
- Test: `test/enrichClients.test.js` (append)

**Interfaces:**
- Consumes: `PageSpeedClient({ baseUrl })` from Task 2.
- Produces: `buildEnrichClients({ lighthouseUrl })` passes `baseUrl: lighthouseUrl` to the PageSpeed client; CrUX is unaffected (still created in fast mode).

- [ ] **Step 1: Write the failing test (append to existing file)**

```js
// append to test/enrichClients.test.js
test("lighthouseUrl is forwarded as the PageSpeed baseUrl", () => {
  const { pageSpeed } = buildEnrichClients({
    apiKey: "k", deep: false, lighthouseUrl: "https://lh.local/run",
    PageSpeedClientCtor: SpyPS, CruxClientCtor: SpyCrux,
  });
  assert.equal(pageSpeed.opts.baseUrl, "https://lh.local/run");
});

test("fast mode still builds a CrUX client when lighthouseUrl is set", () => {
  const { crux } = buildEnrichClients({
    apiKey: "k", deep: false, lighthouseUrl: "https://lh.local/run",
    PageSpeedClientCtor: SpyPS, CruxClientCtor: SpyCrux,
  });
  assert.ok(crux instanceof SpyCrux);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/enrichClients.test.js`
Expected: FAIL — `pageSpeed.opts.baseUrl` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/infrastructure/http/enrichClients.js` body of `buildEnrichClients`:

```js
export function buildEnrichClients({
  apiKey,
  lighthouseUrl,
  deep = false,
  strategy = "mobile",
  PageSpeedClientCtor = PageSpeedClient,
  CruxClientCtor = CruxClient,
} = {}) {
  const categories = deep ? ALL_CATEGORIES : ["performance"];
  const pageSpeed = new PageSpeedClientCtor({ apiKey, baseUrl: lighthouseUrl || "", categories, strategy });
  const crux = deep ? null : new CruxClientCtor({ apiKey });
  return { pageSpeed, crux, categories };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/enrichClients.test.js`
Expected: PASS (4 tests: 2 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/http/enrichClients.js test/enrichClients.test.js
git commit -m "feat(cwv): buildEnrichClients forwards lighthouseUrl as baseUrl"
```

---

### Task 4: CWV cache (C) in `enrichLeads`

**Files:**
- Modify: `src/application/EnrichLeads.js` (extract resolve + map helpers; add `options.cwvCache`)
- Test: `test/enrich.cache.test.js`

**Interfaces:**
- Consumes: `cacheKey` from `./jobCache.js`.
- Produces: `enrichLeads(comSite, ps, onProgress, { cwvCache })` — when `cwvCache` (a Memo) is provided, the expensive network resolution (CrUX query OR `analyze`) runs once per normalized domain; per-lead column mapping still runs for every lead. Behavior identical when `cwvCache` absent.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/enrich.cache.test.js`
Expected: FAIL — `counter.n` is `2` (no cache wired yet).

- [ ] **Step 3: Write minimal implementation**

Rewrite `src/application/EnrichLeads.js` as follows (keeps `joinOpportunities`, adds helpers + cache):

```js
import { classifyCwv } from "../domain/classification.js";
import { buildAuditReportModel } from "./buildAuditReportModel.js";
import { runPool } from "./concurrentPool.js";
import { cacheKey } from "./jobCache.js";

const DEFAULT_CONCURRENCY = 8;

function joinOpportunities(report) {
  return (report.opportunities || [])
    .slice(0, 5)
    .map((o) => (o.display ? `${o.title} (${o.display})` : o.title))
    .join(" | ");
}

/** Mapeia o dado de campo (CrUX) para as colunas do lead. */
function cruxFields(f) {
  return {
    cwv_score: f.score,
    cwv_status: classifyCwv(f.score),
    cwv_erro: "",
    cwv_lcp: f.lcp?.p75 != null ? `${f.lcp.p75} ms` : "",
    cwv_fcp: f.fcp?.p75 != null ? `${f.fcp.p75} ms` : "",
    cwv_cls: f.cls?.p75 != null ? String(f.cls.p75) : "",
    cwv_tbt: "",
    cwv_si: "",
    cwv_tti: "",
    score_acessibilidade: "",
    score_boas_praticas: "",
    score_seo: "",
    audit_score: "",
    cwv_oportunidades: "",
    cwv_campo: f.overall || "",
    cwv_report: null,
  };
}

/** Mapeia o relatório de laboratório (Lighthouse) + o lead para as colunas. */
function labFields(report, lead) {
  const audit = buildAuditReportModel({ ...lead, cwv_report: report });
  return {
    cwv_score: report.score,
    cwv_status: classifyCwv(report.score),
    cwv_erro: "",
    cwv_lcp: report.metrics.lcp?.display || "",
    cwv_fcp: report.metrics.fcp?.display || "",
    cwv_cls: report.metrics.cls?.display || "",
    cwv_tbt: report.metrics.tbt?.display || "",
    cwv_si: report.metrics.si?.display || "",
    cwv_tti: report.metrics.tti?.display || "",
    score_acessibilidade: report.categories.accessibility ?? "",
    score_boas_praticas: report.categories.bestPractices ?? "",
    score_seo: report.categories.seo ?? "",
    audit_score: audit.SCORE_GERAL,
    cwv_oportunidades: joinOpportunities(report),
    cwv_campo: report.field?.overall || "",
    cwv_report: report,
  };
}

export async function enrichLeads(comSite = [], pageSpeedClient, onProgress, options = {}) {
  let ok = 0;
  let falhas = 0;
  let foraDoAr = 0;
  const cruxClient = options.cruxClient;
  const deep = !!options.deep;
  const healthChecker = options.healthChecker;
  const cwvCache = options.cwvCache;

  // Parte CARA (rede), cacheável por domínio. Devolve um discriminado:
  //   { kind: "crux", field } | { kind: "lab", report }
  async function resolveCwv(url) {
    if (cruxClient && !deep) {
      try {
        const f = await cruxClient.query(url);
        if (f && f.hasField) return { kind: "crux", field: f };
      } catch {
        /* CrUX falhou/timeout: cai para o Lighthouse abaixo */
      }
    }
    const report = await pageSpeedClient.analyze(url);
    return { kind: "lab", report };
  }

  const leads = await runPool(comSite, {
    concurrency: options.concurrency || DEFAULT_CONCURRENCY,
    task: async (lead) => {
      // 0) Pré-checagem opcional de site fora do ar (opt-in).
      if (healthChecker) {
        const h = await healthChecker.check(lead.site);
        if (h.down) {
          foraDoAr++;
          return { ...lead, cwv_score: null, cwv_status: "FORA DO AR", cwv_erro: h.reason || "site fora do ar" };
        }
      }
      // 1+2) Resolve campo (CrUX) ou laboratório (Lighthouse), com dedup por domínio.
      let resolved;
      try {
        resolved = cwvCache
          ? await cwvCache.run(cacheKey(lead.site), () => resolveCwv(lead.site))
          : await resolveCwv(lead.site);
      } catch (e) {
        falhas++;
        return { ...lead, cwv_score: null, cwv_status: "N/A", cwv_erro: e?.message || "falha" };
      }
      ok++;
      return resolved.kind === "crux"
        ? { ...lead, ...cruxFields(resolved.field) }
        : { ...lead, ...labFields(resolved.report, lead) };
    },
    onDone: (done, total, lead, result) =>
      onProgress?.({
        current: done,
        total,
        nome: lead.nome,
        status: result.cwv_status,
        erro: result.cwv_erro || undefined,
      }),
  });

  return { leads, ok, falhas, foraDoAr };
}
```

- [ ] **Step 4: Run test to verify it passes (and existing CrUX-first tests stay green)**

Run: `npm test -- test/enrich.cache.test.js test/enrich.cruxfirst.test.js test/pipeline.test.js`
Expected: PASS — new cache test, plus the existing CrUX-first and pipeline suites unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/application/EnrichLeads.js test/enrich.cache.test.js
git commit -m "feat(cwv): dedup CWV network calls per domain via cwvCache"
```

---

### Task 5: `ensureFullReport` honors the CWV cache

**Files:**
- Modify: `src/application/ensureFullReport.js`
- Test: `test/ensureFullReport.test.js` (append)

**Interfaces:**
- Consumes: `cacheKey` from `./jobCache.js`; a `cwvCache` Memo.
- Produces: `ensureFullReport(lead, ps, cwvCache?)` — when `cwvCache` is provided, the full (deep) Lighthouse analysis is deduped per domain under a `"deep:"`-prefixed key (distinct from the fast-path key). Behavior identical when `cwvCache` absent.

- [ ] **Step 1: Write the failing test (append)**

```js
// append to test/ensureFullReport.test.js
import { createJobCache } from "../src/application/jobCache.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/ensureFullReport.test.js`
Expected: FAIL — `calls` is `2` (cache arg ignored).

- [ ] **Step 3: Write minimal implementation**

```js
// src/application/ensureFullReport.js
import { cacheKey } from "./jobCache.js";

export async function ensureFullReport(lead, pageSpeedClient, cwvCache) {
  if (lead.cwv_report) return lead.cwv_report;
  if (!lead.site) return null;
  // Chave "deep:" separa o relatório completo (4 categorias) do resultado rápido.
  lead.cwv_report = cwvCache
    ? await cwvCache.run("deep:" + cacheKey(lead.site), () => pageSpeedClient.analyze(lead.site))
    : await pageSpeedClient.analyze(lead.site);
  return lead.cwv_report;
}
```

Keep the existing JSDoc block above the function; add `@param` for `cwvCache` (optional).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/ensureFullReport.test.js`
Expected: PASS (4 tests: 3 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/application/ensureFullReport.js test/ensureFullReport.test.js
git commit -m "feat(cwv): ensureFullReport dedupes deep report via cwvCache"
```

---

### Task 6: Page cache (A) in `enrichEmails`

**Files:**
- Modify: `src/application/enrichEmails.js` (phase 1 `scrapeContacts` call; add `options.pageCache`)
- Test: `test/enrich.cache.emails.test.js`

**Interfaces:**
- Consumes: `cacheKey` from `./jobCache.js`; a `pageCache` Memo.
- Produces: `enrichEmails(comSite, emailScraper, onProgress, { pageCache })` — phase-1 `emailScraper.scrapeContacts(site)` is deduped per normalized domain. Browser fallback (phase 2) is untouched.

- [ ] **Step 1: Write the failing test**

```js
// test/enrich.cache.emails.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichEmails } from "../src/application/enrichEmails.js";
import { createJobCache } from "../src/application/jobCache.js";

test("pageCache fetches a shared site once across leads", async () => {
  const calls = new Map();
  const emailScraper = {
    async scrapeContacts(url) {
      calls.set(url, (calls.get(url) || 0) + 1);
      return { emails: ["a@a.com"], socials: [], pagesVisited: 1 };
    },
  };
  const cache = createJobCache();
  const leads = [
    { nome: "A", site: "https://shared.com", site_emails: "" },
    { nome: "B", site: "https://shared.com", site_emails: "" },
  ];
  const out = await enrichEmails(leads, emailScraper, undefined, { pageCache: cache.page });
  assert.equal([...calls.values()].reduce((a, b) => a + b, 0), 1); // one network call total
  assert.equal(out.ok, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/enrich.cache.emails.test.js`
Expected: FAIL — total calls is `2`.

- [ ] **Step 3: Write minimal implementation**

In `src/application/enrichEmails.js`, add the import at the top (next to the existing imports):

```js
import { cacheKey } from "./jobCache.js";
```

Inside `enrichEmails`, before the `runPool` for phase 1, add a wrapper and use it:

```js
  const pageCache = options.pageCache;
  const scrapeContacts = (url) =>
    pageCache ? pageCache.run(cacheKey(url), () => emailScraper.scrapeContacts(url)) : emailScraper.scrapeContacts(url);
```

Then in the phase-1 task, replace `const { emails, socials } = await emailScraper.scrapeContacts(lead.site);` with:

```js
        const { emails, socials } = await scrapeContacts(lead.site);
```

(Leave phase 2's `browserScraper.scrapeContacts` as-is.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/enrich.cache.emails.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/enrichEmails.js test/enrich.cache.emails.test.js
git commit -m "feat(enrich): dedup site fetches in enrichEmails via pageCache"
```

---

### Task 7: Page cache (A) + search cache (B) in `enrichSocials`

**Files:**
- Modify: `src/application/enrichSocials.js` (phase 1 `scrapeContacts`; phase 3 `search`; add `options.pageCache`, `options.searchCache`)
- Test: `test/enrich.cache.socials.test.js`

**Interfaces:**
- Consumes: `cacheKey` from `./jobCache.js`, `buildQueryTerms` from `../infrastructure/scraper/SocialSearchScraper.js`; `pageCache` and `searchCache` Memos.
- Produces: `enrichSocials(busca, scrapers, onProgress, { pageCache, searchCache })` — phase-1 `emailScraper.scrapeContacts(site)` deduped per domain (shares `pageCache` with `enrichEmails`); phase-3 `socialSearchScraper.search(lead)` deduped per `nome|cidade|estado` query.

- [ ] **Step 1: Write the failing test**

```js
// test/enrich.cache.socials.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichSocials } from "../src/application/enrichSocials.js";
import { createJobCache } from "../src/application/jobCache.js";

test("searchCache runs identical web searches once across leads", async () => {
  let searches = 0;
  const socialSearchScraper = {
    async search() { searches++; return ["https://instagram.com/foo"]; },
  };
  const cache = createJobCache();
  const semSite = [
    { nome: "Bar do Zé", cidade: "Campinas", estado: "SP", redes_sociais: "" },
    { nome: "Bar do Zé", cidade: "Campinas", estado: "SP", redes_sociais: "" },
  ];
  const out = await enrichSocials(
    { comSite: [], semSite },
    { socialSearchScraper },
    undefined,
    { searchCache: cache.search }
  );
  assert.equal(searches, 1);       // one DDG search for the identical query
  assert.equal(out.viaBusca, 2);   // both leads still receive the profile
});

test("pageCache fetches a shared site once in the site phase", async () => {
  const calls = new Map();
  const emailScraper = {
    async scrapeContacts(url) {
      calls.set(url, (calls.get(url) || 0) + 1);
      return { socials: ["https://instagram.com/foo"] };
    },
  };
  const cache = createJobCache();
  const comSite = [
    { nome: "A", site: "https://shared.com", redes_sociais: "" },
    { nome: "B", site: "https://shared.com", redes_sociais: "" },
  ];
  const out = await enrichSocials({ comSite, semSite: [] }, { emailScraper }, undefined, { pageCache: cache.page });
  assert.equal([...calls.values()].reduce((a, b) => a + b, 0), 1);
  assert.equal(out.ok, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/enrich.cache.socials.test.js`
Expected: FAIL — `searches` is `2` and shared-site calls total `2`.

- [ ] **Step 3: Write minimal implementation**

In `src/application/enrichSocials.js`, add imports at the top (next to existing imports):

```js
import { cacheKey } from "./jobCache.js";
import { buildQueryTerms } from "../infrastructure/scraper/SocialSearchScraper.js";
```

Inside `enrichSocials`, after destructuring `scrapers`, add wrappers:

```js
  const pageCache = options.pageCache;
  const searchCache = options.searchCache;
  const scrapeContacts = (url) =>
    pageCache ? pageCache.run(cacheKey(url), () => emailScraper.scrapeContacts(url)) : emailScraper.scrapeContacts(url);
  const searchSocial = (lead) => {
    if (!searchCache) return socialSearchScraper.search(lead);
    return searchCache.run(buildQueryTerms(lead).toLowerCase(), () => socialSearchScraper.search(lead));
  };
```

In phase 1, replace `const { socials } = await emailScraper.scrapeContacts(lead.site);` with:

```js
        const { socials } = await scrapeContacts(lead.site);
```

In phase 3, replace `const socials = await socialSearchScraper.search(lead);` with:

```js
            const socials = await searchSocial(lead);
```

(Leave phase 2's `browserScraper.scrapeContacts` as-is.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/enrich.cache.socials.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/enrichSocials.js test/enrich.cache.socials.test.js
git commit -m "feat(enrich): dedup site fetches and web searches in enrichSocials"
```

---

### Task 8: Server wiring — create per-job cache, forward `lighthouseUrl`

**Files:**
- Modify: `src/infrastructure/http/server.js` (import jobCache; `cacheFor` helper; `/api/enrich`, `/api/emails`, `/api/socials`, `/api/report` handlers)
- Test: `test/server.cache.test.js`

**Interfaces:**
- Consumes: `createJobCache` from `../../application/jobCache.js`; the cache-aware app functions from Tasks 4–7; `buildEnrichClients({ lighthouseUrl })` from Task 3.
- Produces: a single `item.cache` per job, reused across enrich/emails/socials/report routes; `lighthouseUrl` read from `req.query.lighthouseUrl || process.env.LIGHTHOUSE_SERVER_URL` in `/api/enrich` and `/api/report`.

- [ ] **Step 1: Write the failing test**

```js
// test/server.cache.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createServer } from "../src/infrastructure/http/server.js";

function get(server, path) {
  return new Promise((resolve) => {
    const { port } = server.address();
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    });
  });
}

// Extrai o id do evento SSE "done" do /api/scrape.
function idFromDone(body) {
  const m = body.match(/event: done\s*\ndata: (\{.*\})/);
  return m ? JSON.parse(m[1]).id : null;
}

test("per-job page cache is reused across the emails and socials routes", async () => {
  const calls = new Map();
  const engines = { get: () => ({ name: "playwright", supportsBrowser: true }), async closeAll() {} };
  const scraper = {
    async scrape() {
      return [
        { nome: "A", site: "https://shared.com", telefone: "1111" },
        { nome: "B", site: "https://shared.com", telefone: "2222" },
      ];
    },
  };
  const emailScraper = {
    async scrapeContacts(url) {
      calls.set(url, (calls.get(url) || 0) + 1);
      return { emails: ["a@a.com"], socials: [], pagesVisited: 1 };
    },
  };
  const app = createServer({ scraper, gridScraper: null, emailScraper, engines });
  const server = app.listen(0);
  try {
    const scrapeBody = await get(server, "/api/scrape?input=teste");
    const id = idFromDone(scrapeBody);
    assert.ok(id, "scrape returned an id");
    await get(server, `/api/emails/${id}`);
    const afterEmails = [...calls.values()].reduce((a, b) => a + b, 0);
    assert.equal(afterEmails, 1, "emails route fetched the shared site once");
    await get(server, `/api/socials/${id}`);
    const afterSocials = [...calls.values()].reduce((a, b) => a + b, 0);
    assert.equal(afterSocials, 1, "socials route reused the cached fetch");
  } finally {
    server.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/server.cache.test.js`
Expected: FAIL — without wiring, `afterEmails` is `2` (one fetch per lead) and `afterSocials` is `3`.

- [ ] **Step 3: Write minimal implementation**

In `src/infrastructure/http/server.js`, add the import (next to the other application imports near `:25-33`):

```js
import { createJobCache } from "../../application/jobCache.js";
```

Inside `createServer`, right after `const store = new Map();` (`:135`), add:

```js
  /** Cache/dedup do job (criado sob demanda; some com o job). */
  const cacheFor = (item) => (item.cache ||= createJobCache());
```

In `/api/enrich/:id` (`:254-274`), read the URL and pass the cache:

```js
    const apiKey = (req.query.key || "").toString().trim();
    const lighthouseUrl = (req.query.lighthouseUrl || process.env.LIGHTHOUSE_SERVER_URL || "").toString().trim();
    const deep = req.query.deep === "1";
    const { pageSpeed: client, crux } = buildEnrichClients({ apiKey, deep, lighthouseUrl });
    const cache = cacheFor(item);
```

and in the `enrichLeads(...)` options object (`:274`):

```js
          { concurrency, cruxClient: crux, deep, cwvCache: cache.cwv }
```

In `/api/emails/:id`, add `const cache = cacheFor(item);` after resolving `item`, and extend the `enrichEmails(...)` options (`:366`):

```js
          { concurrency, browserScraper, browserConcurrency, pageCache: cache.page }
```

In `/api/socials/:id`, add `const cache = cacheFor(item);` after resolving `item`, and extend the `enrichSocials(...)` options (`:421`):

```js
          { concurrency, browserConcurrency, pageCache: cache.page, searchCache: cache.search }
```

In `/api/report/:id/lead/:b/:i.html` (`:458-461`), forward the URL and the cache:

```js
        const apiKey = (req.query.key || "").toString().trim();
        const lighthouseUrl = (req.query.lighthouseUrl || process.env.LIGHTHOUSE_SERVER_URL || "").toString().trim();
        const { pageSpeed } = buildEnrichClients({ apiKey, deep: true, lighthouseUrl });
        await ensureFullReport(lead, pageSpeed, cacheFor(item).cwv);
```

- [ ] **Step 4: Run test to verify it passes (and the existing server test stays green)**

Run: `npm test -- test/server.cache.test.js test/server.engine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/http/server.js test/server.cache.test.js
git commit -m "feat(server): wire per-job cache and lighthouseUrl across enrich routes"
```

---

### Task 9: Front-end field + env documentation

**Files:**
- Modify: `public/index.html:138-148` (advanced options row)
- Modify: `public/app.js:422-429` (`enrich()` params)
- Modify: `.env.example` (append `LIGHTHOUSE_SERVER_URL`)

**Interfaces:**
- Consumes: the `lighthouseUrl` query param read by `/api/enrich` in Task 8.
- Produces: an `#lighthouseUrl` input whose trimmed value is sent as `lighthouseUrl` on the enrich request.

- [ ] **Step 1: Add the input to the advanced options block**

In `public/index.html`, inside `<div class="adv-body">`, immediately AFTER the closing `</div>` of the first `.row` (the row containing `#key` and `#conc`, ending at `:148`) and BEFORE `<div class="toggle-grid" ...>` (`:150`), insert:

```html
          <div class="row" style="margin-top: var(--s4);">
            <div style="flex: 1 1 100%;">
              <label for="lighthouseUrl">Instância Lighthouse (opcional — usa o PageSpeed do Google se vazio)<span class="help tip-start" tabindex="0" role="note" aria-label="URL de uma instância Lighthouse própria (self-hosted) compatível com o PageSpeed. Acelera a análise de laboratório por evitar a fila da API do Google. O CrUX (dado de campo) continua vindo do Google. Deixe vazio para usar o PageSpeed Insights." data-tip="URL de uma instância Lighthouse própria (self-hosted) compatível com o PageSpeed. Acelera o laboratório por evitar a fila do Google. O CrUX continua do Google. Vazio = PageSpeed Insights."></span></label>
              <input id="lighthouseUrl" type="url" placeholder="https://lighthouse.seudominio.com" autocomplete="off" />
            </div>
          </div>
```

- [ ] **Step 2: Send the value from `enrich()`**

In `public/app.js`, in `enrich()` (`:424-427`), add the field to the `URLSearchParams`:

```js
  const params = new URLSearchParams({
    key: $("key").value.trim(),
    conc: parseInt($("conc").value, 10) || 12,
    lighthouseUrl: $("lighthouseUrl").value.trim(),
  });
```

- [ ] **Step 3: Document the env var**

Append to `.env.example`:

```bash

# Instância Lighthouse self-hosted (opcional). Quando preenchida, a análise de
# laboratório (o passo lento) vai para esta URL em vez da API do Google. Deve ser
# compatível com o PageSpeed (devolve { lighthouseResult } ou o lhr cru). O CrUX
# (dado de campo) continua vindo do Google. Vazio = usa o PageSpeed Insights.
# Pode ser sobreposto pelo campo "Instância Lighthouse" da interface.
LIGHTHOUSE_SERVER_URL=
```

- [ ] **Step 4: Verify (full suite + manual smoke)**

Run: `npm test`
Expected: full suite green (no regressions).

Manual smoke (no network needed for the UI check):
1. `npm start`, open `http://localhost:3000`.
2. Expand "Opções avançadas" — confirm the "Instância Lighthouse" field renders with its `?` tooltip.
3. In devtools, run a search, then click the enrich action and confirm the request URL to `/api/enrich/...` carries `lighthouseUrl=` (empty if the field is blank).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js .env.example
git commit -m "feat(ui): add self-hosted Lighthouse instance field"
```

---

## Final verification

- [ ] Run the whole suite: `npm test` — expect all green (existing 75 + the new cache/baseUrl/enrichClients tests).
- [ ] Confirm with `lighthouseUrl` empty and no repeated domains, behavior matches today (covered by existing `enrich.cruxfirst`, `pagespeed.categories`, `pipeline` suites staying green).

## Self-Review notes (coverage map)

- Spec "Feature 1 / contrato aceitar ambos" → Task 2 (bare-lhr + envelope), Task 3 (forward), Task 8 (server read + env), Task 9 (UI field).
- Spec "CrUX primeiro, self-hosted no fallback" → Task 3 keeps CrUX in fast mode; Task 4 `resolveCwv` tries CrUX before `analyze`.
- Spec "(A) cache de fetch" → Task 6 (emails) + Task 7 (socials), shared via `cache.page` in Task 8.
- Spec "(B) cache de buscas web" → Task 7 (`searchCache` keyed by `buildQueryTerms`).
- Spec "(C) cache CWV + relatório individual" → Task 4 (`cwvCache`) + Task 5 (`ensureFullReport` deep key) + Task 8 wiring.
- Spec "front-end" → Task 9. Spec "testes" → each task is TDD; integration via Task 8.
