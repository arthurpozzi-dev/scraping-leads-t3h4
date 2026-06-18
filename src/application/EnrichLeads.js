/**
 * Caso de uso: ENRIQUECIMENTO da lista "com site" com Core Web Vitals.
 *
 * Para cada lead com site próprio, consulta a performance do site através de um
 * cliente injetado (porta `pageSpeedClient`) e preenche as colunas de relatório
 * (score, status, métricas, categorias, oportunidades) — ver buildAuditReportModel
 * para a nota de auditoria 0–10 derivada disso.
 *
 * Roda com paralelismo limitado (o PageSpeed é lento). Erros por item são
 * tolerados — o lead recebe status "N/A" e o motivo em `cwv_erro`.
 */
import { classifyCwv } from "../domain/classification.js";
import { buildAuditReportModel } from "./buildAuditReportModel.js";
import { runPool } from "./concurrentPool.js";
import { cacheKey } from "./jobCache.js";

/** Quantos sites analisar ao mesmo tempo (padrão; configurável via opção). */
const DEFAULT_CONCURRENCY = 8;

/** Junta as principais oportunidades do relatório numa string para a planilha. */
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

/**
 * @param {import("../domain/Lead.js").Lead[]} comSite
 * @param {{ analyze: (url:string)=>Promise<any> }} pageSpeedClient
 * @param {(p: { current:number, total:number, nome:string, status:string, erro?:string }) => void} [onProgress]
 * @param {{ concurrency?: number, healthChecker?: { check:(url:string)=>Promise<{down:boolean,reason?:string}>, cwvCache?: any } }} [options]
 * @returns {Promise<{ leads: import("../domain/Lead.js").Lead[], ok: number, falhas: number, foraDoAr: number }>}
 */
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
        // A chave embute o modo: um relatório "fast" (CrUX+performance) não pode
        // ser servido a um job "deep" (4 categorias) do MESMO domínio, e vice-versa.
        const key = `${deep ? "deep" : "fast"}:${cacheKey(lead.site)}`;
        resolved = cwvCache
          ? await cwvCache.run(key, () => resolveCwv(lead.site))
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
