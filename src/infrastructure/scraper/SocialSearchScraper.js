/**
 * Descoberta de redes sociais por BUSCA WEB (opt-in).
 *
 * Para leads sem perfil conhecido — tipicamente os "sem site" —, pesquisa o nome
 * do estabelecimento (mais cidade/UF, quando houver) num buscador e colhe os
 * resultados que apontam para uma rede social. Usa o endpoint HTML do DuckDuckGo
 * (`html.duckduckgo.com/html/`), que dispensa chave de API e devolve HTML simples.
 *
 * AVISO: scraping de buscador é área cinzenta de Termos de Uso e tem rate-limit;
 * por isso este passo é OPCIONAL (ligado por um flag na interface), roda com
 * baixa concorrência e pode trazer o perfil errado. É um melhor-esforço.
 */
import { normalizeSocialUrl, socialPlatform } from "../../domain/classification.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Extrai as URLs reais dos resultados do HTML do DuckDuckGo. Os links vêm
 * embrulhados num redirecionador (`/l/?uddg=<url-encoded>`); decodificamos o
 * parâmetro `uddg` para obter o destino verdadeiro.
 * @param {string} html
 * @returns {string[]}
 */
export function parseDuckResults(html) {
  if (!html) return [];
  const out = [];
  for (const m of html.matchAll(/uddg=([^&"']+)/gi)) {
    try {
      out.push(decodeURIComponent(m[1]));
    } catch {
      /* sequência inválida: ignora */
    }
  }
  return out;
}

/** Monta os termos de busca a partir dos dados do lead (nome + cidade/UF). */
export function buildQueryTerms(lead) {
  return [lead?.nome, lead?.cidade, lead?.estado].map((s) => (s || "").trim()).filter(Boolean).join(" ");
}

export class SocialSearchScraper {
  /**
   * @param {Object} [options]
   * @param {number} [options.timeoutMs=12000]
   * @param {string[]} [options.platforms=["instagram","facebook","linkedin"]] redes pesquisadas (uma busca cada)
   * @param {number} [options.maxPerLead=3]   teto de perfis por lead
   * @param {number} [options.delayMs=400]    pausa entre buscas (educação com o buscador)
   */
  constructor({ timeoutMs = 12000, platforms = ["instagram", "facebook", "linkedin"], maxPerLead = 3, delayMs = 400 } = {}) {
    this.timeoutMs = timeoutMs;
    this.platforms = platforms;
    this.maxPerLead = maxPerLead;
    this.delayMs = delayMs;
  }

  /** Uma consulta ao DuckDuckGo HTML; devolve o HTML da página de resultados. */
  async #query(q) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${DDG_ENDPOINT}?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
        headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Procura os perfis sociais de um lead. Faz uma busca por plataforma e mantém,
   * de cada uma, o primeiro resultado cujo destino seja daquela rede.
   * @param {import("../../domain/Lead.js").Lead} lead
   * @returns {Promise<string[]>} perfis canônicos encontrados (pode ser vazio).
   */
  async search(lead) {
    const terms = buildQueryTerms(lead);
    if (!terms) return [];

    const found = new Set();
    for (const platform of this.platforms) {
      if (found.size >= this.maxPerLead) break;
      let html;
      try {
        html = await this.#query(`${terms} ${platform}`);
      } catch {
        continue; // uma busca que falha não derruba as outras
      }
      for (const raw of parseDuckResults(html)) {
        const profile = normalizeSocialUrl(raw);
        if (profile && socialPlatform(profile) === platform) {
          found.add(profile);
          break; // só o melhor (primeiro) resultado daquela plataforma
        }
      }
      if (this.delayMs) await sleep(this.delayMs);
    }
    return [...found];
  }
}
