/**
 * Regras de classificação puras do domínio.
 *
 * Não dependem de I/O nem de framework. Aqui ficam as listas de domínios que
 * NÃO devem ser tratados como "site próprio" do estabelecimento e os limites
 * (thresholds) usados para classificar a performance do site (Core Web Vitals).
 */

/**
 * Domínios de redes sociais e agregadores de links.
 *
 * Muitos estabelecimentos cadastram um Instagram, Facebook ou um Linktree no
 * campo "site" do Google Maps. Para o nosso fluxo, isso NÃO conta como site
 * próprio — esses leads vão para a lista "sem site" e o link é guardado em
 * `redes_sociais`.
 */
export const SOCIAL_DOMAINS = [
  "instagram.com",
  "facebook.com",
  "fb.com",
  "fb.me",
  "m.facebook.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "wa.me",
  "whatsapp.com",
  "api.whatsapp.com",
  "t.me",
  "telegram.me",
  "telegram.org",
  // Agregadores de links ("link na bio")
  "linktr.ee",
  "linktree.com",
  "bio.link",
  "beacons.ai",
  "campsite.bio",
  "linkr.bio",
  "lnk.bio",
  "many.link",
  "msha.ke",
  "linkin.bio",
];

/**
 * Limites de classificação do Core Web Vitals (faixas padrão do Lighthouse).
 * Score de performance vai de 0 a 100.
 */
export const CWV_THRESHOLDS = {
  BOM: 90, // score >= 90  -> "BOM"
  MEDIO: 50, // 50 <= score < 90 -> "MÉDIO"; abaixo de 50 -> "RUIM"
};

/**
 * Extrai o hostname (em minúsculas, sem "www.") de uma URL.
 * @param {string} url
 * @returns {string} hostname ou "" se a URL for inválida.
 */
export function getHostname(url) {
  if (!url) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withProtocol).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Diz se uma URL aponta para uma rede social ou agregador de links
 * (ou seja, NÃO é um site próprio do estabelecimento).
 * @param {string} url
 * @returns {boolean}
 */
export function isSocialOrAggregator(url) {
  const host = getHostname(url);
  if (!host) return false;
  return SOCIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Classifica um score de performance (0–100) em RUIM / MÉDIO / BOM.
 * @param {number} score
 * @returns {"RUIM"|"MÉDIO"|"BOM"}
 */
export function classifyCwv(score) {
  if (score >= CWV_THRESHOLDS.BOM) return "BOM";
  if (score >= CWV_THRESHOLDS.MEDIO) return "MÉDIO";
  return "RUIM";
}

/**
 * Identifica a PLATAFORMA social de uma URL (instagram, facebook, …) — útil para
 * normalizar perfis e, futuramente, separar a planilha por rede. Aceita só os
 * domínios de `SOCIAL_DOMAINS`; qualquer outro agregador conhecido vira "other".
 * @param {string} url
 * @returns {""|"instagram"|"facebook"|"twitter"|"tiktok"|"youtube"|"linkedin"|"whatsapp"|"telegram"|"linktree"|"other"}
 */
export function socialPlatform(url) {
  const host = getHostname(url);
  if (!host) return "";
  const is = (d) => host === d || host.endsWith(`.${d}`);
  if (is("instagram.com")) return "instagram";
  if (is("facebook.com") || host === "fb.com" || host === "fb.me") return "facebook";
  if (is("twitter.com") || host === "x.com") return "twitter";
  if (is("tiktok.com")) return "tiktok";
  if (is("youtube.com") || host === "youtu.be") return "youtube";
  if (is("linkedin.com")) return "linkedin";
  if (host === "wa.me" || is("whatsapp.com")) return "whatsapp";
  if (is("t.me") || is("telegram.me") || is("telegram.org")) return "telegram";
  if (is("linktr.ee") || is("linktree.com")) return "linktree";
  return isSocialOrAggregator(url) ? "other" : "";
}

/**
 * Primeiros segmentos de caminho que NÃO são um perfil/página, mas ações de
 * compartilhamento, login, busca ou itens de conteúdo (um post, um vídeo). Valem
 * para todas as plataformas — nenhum deles é raiz de perfil em nenhuma delas.
 */
const NON_PROFILE_SEGMENTS = new Set([
  "sharer", "share", "sharer.php", "plugins", "dialog", "login", "tr", "l.php",
  "intent", "home", "hashtag", "search", "explore", "accounts", "stories",
  "watch", "embed", "results", "feed", "sharearticle", "sharing", "p", "reel",
  "reels", "status", "tagged",
  // LinkedIn: conteúdo/ações que não são perfil (/in/ e /company/ continuam valendo).
  "posts", "jobs", "pulse",
]);

/**
 * Normaliza uma URL de rede social para a forma canônica do PERFIL, ou devolve ""
 * quando a URL não é um perfil utilizável (link de compartilhamento, post, página
 * inicial da rede, etc.).
 *
 * - tira `www.`/`m.`, query e fragmento (exceto o telefone do WhatsApp);
 * - descarta caminhos de ação/conteúdo (`/sharer`, `/intent`, `/p/<post>`…);
 * - WhatsApp: só mantém quando há um número (`wa.me/55…`, `api.whatsapp.com/send?phone=`);
 * - exige um caminho (a raiz `facebook.com/` sozinha não é um perfil).
 *
 * @param {string} url
 * @returns {string} URL canônica do perfil (https, sem www/query) ou "".
 */
export function normalizeSocialUrl(url) {
  const platform = socialPlatform(url);
  if (!platform) return "";

  let u;
  try {
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    u = new URL(withProtocol);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");

  // WhatsApp: o "perfil" é o número. Aceita wa.me/<num> e api.whatsapp.com/send?phone=.
  if (platform === "whatsapp") {
    const fromPath = u.pathname.replace(/\D/g, "");
    const fromQuery = (u.searchParams.get("phone") || "").replace(/\D/g, "");
    const num = fromPath || fromQuery;
    return num ? `https://wa.me/${num}` : "";
  }

  const segments = u.pathname.split("/").filter(Boolean);
  if (!segments.length) return ""; // raiz da rede, sem perfil

  // Exceção: o Facebook usa /profile.php?id=<id> como perfil legítimo (precisa da query).
  if (platform === "facebook" && segments[0].toLowerCase() === "profile.php") {
    const id = u.searchParams.get("id");
    return id ? `https://facebook.com/profile.php?id=${id}` : "";
  }
  if (NON_PROFILE_SEGMENTS.has(segments[0].toLowerCase())) return "";
  // YouTube só tem perfil em /channel, /c, /user e /@handle.
  if (platform === "youtube") {
    const head = segments[0].toLowerCase();
    const ok = head.startsWith("@") || ["channel", "c", "user"].includes(head);
    if (!ok) return "";
  }

  const path = "/" + segments.join("/");
  return `https://${host}${path}`;
}

/**
 * Mescla links de redes sociais a um campo `redes_sociais` existente (string com
 * itens separados por " | "), normalizando e deduplicando pelo perfil canônico.
 * Itens já existentes que não forem reconhecíveis como rede são preservados como
 * estão (não perde dado), mas não são duplicados.
 * @param {string} existing  valor atual de `redes_sociais` (pode ser "")
 * @param {string[]} found    URLs encontradas (cruas)
 * @returns {string} novo valor de `redes_sociais` (" | "-juntado)
 */
export function mergeSocialLinks(existing, found = []) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const value = normalizeSocialUrl(raw) || (raw || "").trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };
  for (const item of (existing || "").split(" | ")) add(item);
  for (const item of found) add(item);
  return out.join(" | ");
}

// ---- Validação / confiança das redes sociais -----------------------------
//
// O risco real de um link errado vem da DESCOBERTA POR BUSCA WEB (fonte "busca"):
// o buscador pode trazer o perfil de um homônimo. Links vindos do próprio site do
// lead, do navegador (mesmo site renderizado) ou do Google Maps são declarados
// pelo próprio negócio — confiança alta. Por isso a checagem só escrutina os de
// busca, cruzando o nome do estabelecimento com o "handle" do perfil.

/** Palavras que não ajudam a casar o nome do negócio com o handle do perfil. */
const NAME_STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "no", "na",
  "ltda", "me", "epp", "cia", "the", "of", "and",
]);

/** Tokeniza um nome: sem acento, minúsculo, tokens alfanuméricos (≥3), sem stopwords. */
function nameTokens(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

/**
 * "Handle" (parte identificadora) de um perfil social, só com alfanuméricos.
 * Pula prefixos que não são o handle (`/in/`, `/company/`, `/channel/`, `@`).
 * @param {string} url
 * @returns {string}
 */
function profileHandle(url) {
  const norm = normalizeSocialUrl(url) || url || "";
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(norm) ? norm : `https://${norm}`);
  } catch {
    return "";
  }
  const segs = u.pathname.split("/").filter(Boolean);
  if (!segs.length) return "";
  const skip = new Set(["in", "company", "channel", "c", "user", "profile.php"]);
  let seg = segs[0].toLowerCase();
  if (skip.has(seg) && segs[1]) seg = segs[1].toLowerCase();
  return seg.replace(/^@/, "").replace(/[^a-z0-9]+/g, "");
}

/**
 * Mede de 0 a 1 o quanto o handle de um perfil casa com o nome do negócio.
 * Heurística pura (sem rede): sobreposição de tokens + contenção do handle no
 * nome concatenado. Imperfeita (handles costumam ser abreviados), serve para
 * REBAIXAR resultados de busca claramente errados, não como prova.
 * @param {string} nome
 * @param {string} url
 * @returns {number} 0..1
 */
export function socialNameMatch(nome, url) {
  const toks = nameTokens(nome);
  const handle = profileHandle(url);
  if (!toks.length || handle.length < 3) return 0;
  const concat = toks.join("");
  const hits = toks.filter((t) => handle.includes(t) || (handle.length >= 4 && t.includes(handle))).length;
  const tokenScore = hits / toks.length;
  const containment = handle.length >= 4 && (concat.includes(handle) || handle.includes(concat)) ? 1 : 0;
  return Math.max(tokenScore, containment);
}

/** Casamento de nome a partir do qual um link de busca é considerado "provável". */
export const SOCIAL_MATCH_OK = 0.5;

/**
 * Confiança de um link social conforme a FONTE e, só para "busca", o casamento
 * do nome. Tudo que o negócio declara (próprio site, navegador, Maps) e qualquer
 * fonte desconhecida (que só pode ter vindo do Maps/site, anterior à busca) é alta.
 * @param {"maps"|"site"|"navegador"|"busca"|string|undefined} fonte
 * @param {number} [nameScore=0]
 * @returns {"alta"|"media"|"baixa"}
 */
export function socialConfidence(fonte, nameScore = 0) {
  if (fonte === "busca") return nameScore >= SOCIAL_MATCH_OK ? "media" : "baixa";
  return "alta";
}

/**
 * Registra a fonte dos links sociais RECÉM-adicionados num passo de enriquecimento.
 * Marca só os que não estavam em `antes` e ainda não têm fonte (o primeiro a
 * registrar vence: o site sempre ganha da busca). Não perde as fontes anteriores.
 * @param {Record<string,string>} fontes  mapa atual url→fonte (pode ser undefined)
 * @param {string} antes   `redes_sociais` ANTES do merge
 * @param {string} depois  `redes_sociais` DEPOIS do merge
 * @param {"site"|"navegador"|"busca"} fonte
 * @returns {Record<string,string>} novo mapa url→fonte
 */
export function recordSocialSources(fontes = {}, antes = "", depois = "", fonte) {
  const before = new Set((antes || "").split(" | ").filter(Boolean));
  const out = { ...fontes };
  for (const url of (depois || "").split(" | ").filter(Boolean)) {
    if (!before.has(url) && !(url in out)) out[url] = fonte;
  }
  return out;
}

/**
 * Avalia cada rede social de um lead, combinando a fonte (mapa `redes_fontes`,
 * default "maps" para links sem fonte) com o casamento do nome.
 * @param {{ nome?:string, redes_sociais?:string, redes_fontes?:Record<string,string> }} lead
 * @returns {{ url:string, plataforma:string, fonte:string, confianca:"alta"|"media"|"baixa" }[]}
 */
export function evaluateSocials(lead = {}) {
  const fontes = lead.redes_fontes || {};
  return (lead.redes_sociais || "")
    .split(" | ")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => {
      const fonte = fontes[url] || "maps";
      return { url, plataforma: socialPlatform(url), fonte, confianca: socialConfidence(fonte, socialNameMatch(lead.nome, url)) };
    });
}
