/**
 * Caso de uso: DESCOBERTA de REDES SOCIAIS dos leads.
 *
 * Preenche/complementa o campo `redes_sociais` em três fases, da mais barata e
 * confiável para a mais cara e incerta — sempre MESCLANDO com o que o lead já
 * tinha (do Google Maps), nunca perdendo links:
 *
 *   Fase 1 — SITE (fetch nativo, lista "com site"): extrai os perfis sociais do
 *            HTML do próprio site (home + páginas de contato), via `emailScraper`.
 *   Fase 1.5 — ANTI-BAN (opcional): re-tenta SÓ os sites que BLOQUEARAM o fetch
 *            nativo, via engine em modo HTTP (Scrapling fast), via `engineScraper`.
 *   Fase 2 — NAVEGADOR (opcional, lista "com site"): renderiza num browser real os
 *            sites que ficaram sem rede (sites 100% JavaScript), via `browserScraper`.
 *   Fase 3 — BUSCA WEB (opcional, qualquer lista): para quem ficou sem rede — com
 *            ou sem site —, pesquisa o nome do lead num buscador, via `socialSearchScraper`.
 *
 * Erros por item são tolerados: o lead mantém o que tinha.
 */
import { mergeSocialLinks, recordSocialSources } from "../domain/classification.js";
import { runPool } from "./concurrentPool.js";
import { cacheKey } from "./jobCache.js";
import { buildQueryTerms } from "../infrastructure/scraper/SocialSearchScraper.js";

const DEFAULT_CONCURRENCY = 20; // fetch nativo: I/O puro, escala bem
const DEFAULT_ENGINE_CONCURRENCY = 4;
const DEFAULT_BROWSER_CONCURRENCY = 2;
const DEFAULT_SEARCH_CONCURRENCY = 2;

/** Quantas redes há no campo `redes_sociais` de um lead. */
const socialCount = (lead) => (lead.redes_sociais || "").split(" | ").filter(Boolean).length;

/**
 * @param {{ comSite?: import("../domain/Lead.js").Lead[], semSite?: import("../domain/Lead.js").Lead[] }} busca
 * @param {{ emailScraper:{scrapeContacts:(url:string)=>Promise<{socials:string[]}>}, engineScraper?:{scrapeContacts:(url:string)=>Promise<{socials:string[]}>}, browserScraper?:{scrapeContacts:(url:string)=>Promise<{socials:string[]}>}, socialSearchScraper?:{search:(lead:any)=>Promise<string[]>} }} scrapers
 * @param {(p: { fase:"sites"|"anti-ban"|"navegador"|"busca", current:number, total:number, nome:string, encontrados:number, erro?:string }) => void} [onProgress]
 * @param {{ concurrency?: number, engineConcurrency?: number, browserConcurrency?: number, searchConcurrency?: number }} [options]
 * @returns {Promise<{ comSite: any[], semSite: any[], ok: number, semRedes: number, viaBusca: number, falhas: number, antiBan: number }>}
 */
export async function enrichSocials(busca = {}, scrapers = {}, onProgress, options = {}) {
  const { emailScraper, engineScraper, browserScraper, socialSearchScraper } = scrapers;
  const comSite = [...(busca.comSite || [])];
  const semSite = [...(busca.semSite || [])];

  const pageCache = options.pageCache;
  const searchCache = options.searchCache;
  const scrapeContacts = (url) =>
    pageCache ? pageCache.run(cacheKey(url), () => emailScraper.scrapeContacts(url)) : emailScraper.scrapeContacts(url);
  const searchSocial = (lead) => {
    if (!searchCache) return socialSearchScraper.search(lead);
    return searchCache.run(buildQueryTerms(lead).toLowerCase(), () => socialSearchScraper.search(lead));
  };

  // ---- Fase 1: extrai do HTML do próprio site (lista "com site") ----------
  const total = comSite.length;
  let done = 0;
  const com1 = await runPool(comSite, {
    concurrency: options.concurrency || DEFAULT_CONCURRENCY,
    task: async (lead) => {
      try {
        const { socials } = await scrapeContacts(lead.site);
        const antes = lead.redes_sociais || "";
        const merged = mergeSocialLinks(antes, socials);
        return { ...lead, redes_sociais: merged, redes_fontes: recordSocialSources(lead.redes_fontes, antes, merged, "site") };
      } catch (e) {
        return { ...lead, redes_sociais_erro: e?.message || "falha" };
      }
    },
    onDone: (d, t, lead, result) =>
      onProgress?.({ fase: "sites", current: ++done, total, nome: lead.nome, encontrados: socialCount(result), erro: result.redes_sociais_erro || undefined }),
  });

  // ---- Fase 1.5: re-tentativa ANTI-BAN (engine HTTP) p/ quem NÃO carregou ----
  // Mesma cascata do e-mail: só re-tenta os sites que BLOQUEARAM o fetch nativo,
  // via engine em modo HTTP (Scrapling fast) — sem navegador, barato e paralelo.
  let antiBan = 0;
  if (engineScraper) {
    const bloqueados = com1.map((lead, i) => ({ lead, i })).filter(({ lead }) => lead.redes_sociais_erro);
    if (bloqueados.length) {
      const eTotal = bloqueados.length;
      let eDone = 0;
      const scrapeViaEngine = (url) =>
        pageCache ? pageCache.run("eng:" + cacheKey(url), () => engineScraper.scrapeContacts(url)) : engineScraper.scrapeContacts(url);
      await runPool(bloqueados, {
        concurrency: options.engineConcurrency || DEFAULT_ENGINE_CONCURRENCY,
        task: async ({ lead, i }) => {
          try {
            const { socials } = await scrapeViaEngine(lead.site);
            const antes = lead.redes_sociais || "";
            const merged = mergeSocialLinks(antes, socials);
            if (merged !== antes) antiBan++;
            // Engine alcançou o site: limpa o erro do fetch nativo (com rede ou não).
            com1[i] = { ...lead, redes_sociais: merged, redes_fontes: recordSocialSources(lead.redes_fontes, antes, merged, "site"), redes_sociais_erro: "" };
          } catch {
            /* engine também não alcançou: mantém o erro (tenta navegador/busca) */
          }
        },
        onDone: (d, t, { i }) =>
          onProgress?.({ fase: "anti-ban", current: ++eDone, total: eTotal, nome: com1[i].nome, encontrados: socialCount(com1[i]) }),
      });
    }
  }

  // ---- Fase 2: fallback com navegador (sites JS que ficaram sem rede) ------
  if (browserScraper) {
    const pendentes = com1.map((lead, i) => ({ lead, i })).filter(({ lead }) => socialCount(lead) === 0);
    if (pendentes.length) {
      const bTotal = pendentes.length;
      let bDone = 0;
      await runPool(pendentes, {
        concurrency: options.browserConcurrency || DEFAULT_BROWSER_CONCURRENCY,
        task: async ({ lead, i }) => {
          try {
            const { socials } = await browserScraper.scrapeContacts(lead.site);
            const antes = lead.redes_sociais || "";
            const merged = mergeSocialLinks(antes, socials);
            if (merged) {
              const fontes = recordSocialSources(lead.redes_fontes, antes, merged, "navegador");
              com1[i] = { ...lead, redes_sociais: merged, redes_fontes: fontes, redes_sociais_erro: "" };
            }
          } catch {
            /* nem o navegador resolveu: mantém o estado da fase 1 */
          }
        },
        onDone: (d, t, { i }) =>
          onProgress?.({ fase: "navegador", current: ++bDone, total: bTotal, nome: com1[i].nome, encontrados: socialCount(com1[i]) }),
      });
    }
  }

  // ---- Fase 3: busca web (qualquer lead sem rede — com ou sem site) --------
  let viaBusca = 0;
  let outCom = com1;
  let outSem = semSite;
  if (socialSearchScraper) {
    const alvos = [
      ...com1.map((lead, i) => ({ lead, list: "com", i })),
      ...semSite.map((lead, i) => ({ lead, list: "sem", i })),
    ].filter(({ lead }) => socialCount(lead) === 0);

    if (alvos.length) {
      const sTotal = alvos.length;
      let sDone = 0;
      // Cópias mutáveis para gravar os achados por índice/lista.
      outCom = [...com1];
      outSem = [...semSite];
      await runPool(alvos, {
        concurrency: options.searchConcurrency || DEFAULT_SEARCH_CONCURRENCY,
        task: async ({ lead, list, i }) => {
          try {
            const socials = await searchSocial(lead);
            const antes = lead.redes_sociais || "";
            const merged = mergeSocialLinks(antes, socials);
            if (merged && merged !== antes) {
              viaBusca++;
              const fontes = recordSocialSources(lead.redes_fontes, antes, merged, "busca");
              const target = list === "com" ? outCom : outSem;
              target[i] = { ...lead, redes_sociais: merged, redes_fontes: fontes, redes_sociais_erro: "" };
            }
          } catch {
            /* busca que falha não derruba o lead */
          }
        },
        onDone: (d, t, { lead }) =>
          onProgress?.({ fase: "busca", current: ++sDone, total: sTotal, nome: lead.nome, encontrados: 0 }),
      });
    }
  }

  // ---- Contagem final -----------------------------------------------------
  let ok = 0;
  let semRedes = 0;
  let falhas = 0;
  for (const lead of outCom) {
    if (socialCount(lead)) ok++;
    else if (lead.redes_sociais_erro) falhas++;
    else semRedes++;
  }
  for (const lead of outSem) {
    if (socialCount(lead)) ok++;
    else semRedes++;
  }

  return { comSite: outCom, semSite: outSem, ok, semRedes, viaBusca, falhas, antiBan };
}
