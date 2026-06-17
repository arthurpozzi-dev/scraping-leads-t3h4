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

/** Quantos sites analisar ao mesmo tempo (padrão; configurável via opção). */
const DEFAULT_CONCURRENCY = 8;

/** Junta as principais oportunidades do relatório numa string para a planilha. */
function joinOpportunities(report) {
  return (report.opportunities || [])
    .slice(0, 5)
    .map((o) => (o.display ? `${o.title} (${o.display})` : o.title))
    .join(" | ");
}

/**
 * @param {import("../domain/Lead.js").Lead[]} comSite
 * @param {{ analyze: (url:string)=>Promise<any> }} pageSpeedClient
 * @param {(p: { current:number, total:number, nome:string, status:string, erro?:string }) => void} [onProgress]
 * @param {{ concurrency?: number, healthChecker?: { check:(url:string)=>Promise<{down:boolean,reason?:string}> } }} [options]
 * @returns {Promise<{ leads: import("../domain/Lead.js").Lead[], ok: number, falhas: number, foraDoAr: number }>}
 */
export async function enrichLeads(comSite = [], pageSpeedClient, onProgress, options = {}) {
  let ok = 0;
  let falhas = 0;
  let foraDoAr = 0;
  // CrUX-first: dado de campo real (~300ms) evita rodar o Lighthouse (lento) nos
  // sites que têm amostra. `deep` força o Lighthouse completo (4 categorias) e
  // pula o CrUX. O healthcheck virou OPT-IN: o servidor não o passa mais por
  // padrão (mantém o caminho quente rápido), mas quem quiser detectar "FORA DO
  // AR" antes de gastar uma medição ainda pode injetar `healthChecker`.
  const cruxClient = options.cruxClient;
  const deep = !!options.deep;
  const healthChecker = options.healthChecker;

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
      // 1) Tenta dado de campo (CrUX) primeiro — só no modo rápido.
      if (cruxClient && !deep) {
        try {
          const f = await cruxClient.query(lead.site);
          if (f && f.hasField) {
            ok++;
            return {
              ...lead,
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
              cwv_report: null, // sem relatório de laboratório no caminho rápido
            };
          }
        } catch {
          /* CrUX falhou/timeout: cai para o Lighthouse abaixo */
        }
      }
      // 2) Fallback de laboratório (Lighthouse via PageSpeed).
      try {
        const report = await pageSpeedClient.analyze(lead.site);
        const status = classifyCwv(report.score);
        const audit = buildAuditReportModel({ ...lead, cwv_report: report });
        ok++;
        return {
          ...lead,
          cwv_score: report.score,
          cwv_status: status,
          cwv_erro: "",
          // Campos achatados para as colunas da planilha:
          cwv_lcp: report.metrics.lcp?.display || "",
          cwv_fcp: report.metrics.fcp?.display || "",
          cwv_cls: report.metrics.cls?.display || "",
          cwv_tbt: report.metrics.tbt?.display || "",
          cwv_si: report.metrics.si?.display || "",
          cwv_tti: report.metrics.tti?.display || "",
          score_acessibilidade: report.categories.accessibility ?? "",
          score_boas_praticas: report.categories.bestPractices ?? "",
          score_seo: report.categories.seo ?? "",
          audit_score: audit.SCORE_GERAL, // nota geral 0–10 do relatório
          cwv_oportunidades: joinOpportunities(report),
          cwv_campo: report.field?.overall || "", // CrUX (campo), quando houver
          cwv_report: report, // relatório completo (tela + geração de HTML)
        };
      } catch (e) {
        falhas++;
        return { ...lead, cwv_score: null, cwv_status: "N/A", cwv_erro: e?.message || "falha" };
      }
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
