/**
 * Cliente da CrUX API (Chrome UX Report) — dados de CAMPO (usuários reais).
 *
 * Diferente do PageSpeed/Lighthouse (laboratório, lento: 30–90s/site), o CrUX
 * devolve os Core Web Vitals reais agregados (p75) em ~300ms. Só existe para
 * sites com amostra suficiente de tráfego — quando não há, a API responde 404 e
 * aqui retornamos `hasField:false` para o chamador cair no Lighthouse.
 *
 * Usa a MESMA chave da PageSpeed Insights (env PAGESPEED_API_KEY ou injetada).
 * Doc: https://developer.chrome.com/docs/crux/api
 */

const ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

/** Classifica um valor p75 nos limiares oficiais (good / needs-improvement / poor). */
const cat = (v, good, poor) =>
  v == null ? null : v <= good ? "good" : v <= poor ? "needs-improvement" : "poor";

/** Extrai { p75, category } de uma métrica do CrUX. */
const metric = (m, good, poor) => {
  const p75 = m?.percentiles?.p75 ?? null;
  return { p75, category: cat(p75, good, poor) };
};

export class CruxClient {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]   chave da API (sobrepõe a env PAGESPEED_API_KEY)
   * @param {"PHONE"|"DESKTOP"|"TABLET"} [options.strategy="PHONE"]
   * @param {number} [options.timeoutMs=8000]
   * @param {typeof fetch} [options.fetchImpl]   injeção para testes
   */
  constructor({ apiKey, strategy = "PHONE", timeoutMs = 8000, fetchImpl } = {}) {
    this.apiKey = apiKey || process.env.PAGESPEED_API_KEY || "";
    this.strategy = strategy;
    this.timeoutMs = timeoutMs;
    this._fetch = fetchImpl || globalThis.fetch;
  }

  /**
   * Consulta os Core Web Vitals de campo de uma URL.
   * @param {string} url
   * @returns {Promise<{hasField:boolean, overall:string|null, lcp:any, inp:any, cls:any, fcp:any, ttfb:any, score:number|null}>}
   * @throws Error em falhas que não sejam "sem amostra" (404) — para o chamador decidir o fallback.
   */
  async query(url) {
    const empty = { hasField: false, overall: null, lcp: null, inp: null, cls: null, fcp: null, ttfb: null, score: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this._fetch(`${ENDPOINT}?key=${encodeURIComponent(this.apiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ url, formFactor: this.strategy }),
      });
      // 404 = sem amostra de campo para esta URL. Não é erro: cai no Lighthouse.
      if (res.status === 404) return empty;
      if (!res.ok) throw new Error(`CrUX HTTP ${res.status}`);

      const data = await res.json();
      const m = data?.record?.metrics || {};
      const lcp = metric(m.largest_contentful_paint, 2500, 4000);
      const inp = metric(m.interaction_to_next_paint, 200, 500);
      const cls = metric(m.cumulative_layout_shift, 0.1, 0.25);
      const fcp = metric(m.first_contentful_paint, 1800, 3000);
      const ttfb = metric(m.experimental_time_to_first_byte, 800, 1800);

      // Score heurístico 0–100: começa em 100, -25 por core metric (LCP/INP/CLS)
      // que não seja "good". Métrica ausente não penaliza.
      let score = 100;
      for (const x of [lcp, inp, cls]) if (x.category && x.category !== "good") score -= 25;
      score = Math.max(0, score);
      const overall = score >= 90 ? "FAST" : score >= 50 ? "AVERAGE" : "SLOW";

      return { hasField: true, overall, lcp, inp, cls, fcp, ttfb, score };
    } finally {
      clearTimeout(timer);
    }
  }
}
