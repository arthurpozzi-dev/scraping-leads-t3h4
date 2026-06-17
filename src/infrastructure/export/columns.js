/**
 * Definição das colunas das planilhas exportadas.
 *
 * Há dois conjuntos: a lista "sem site" e a lista "com site" (que inclui as
 * colunas de Core Web Vitals geradas no enriquecimento).
 *
 * Os cabeçalhos (`header`) são identificadores em snake_case, sem acento nem
 * espaço, para que outra aplicação consiga consumir a planilha facilmente.
 * Uma coluna pode ter um `value(lead)` para derivar o conteúdo (ex.: separar as
 * redes sociais por plataforma); sem `value`, lê-se direto de `lead[key]`.
 */
import { socialPlatform, evaluateSocials } from "../../domain/classification.js";

/** Plataformas que ganham coluna própria; qualquer outra rede cai em "outras". */
const SOCIAL_COLUMN_PLATFORMS = ["instagram", "facebook", "linkedin"];

/**
 * Extrai do campo `redes_sociais` (string com itens separados por " | ") só os
 * links de uma plataforma. Para `platform === "outras"`, devolve tudo que não é
 * uma das plataformas com coluna própria.
 * @param {Record<string, any>} lead
 * @param {"instagram"|"facebook"|"linkedin"|"outras"} platform
 * @returns {string} links daquela rede juntados por " | " (ou "").
 */
function socialUrlsFor(lead, platform) {
  const links = (lead?.redes_sociais || "").split(" | ").map((s) => s.trim()).filter(Boolean);
  const match =
    platform === "outras"
      ? (u) => !SOCIAL_COLUMN_PLATFORMS.includes(socialPlatform(u))
      : (u) => socialPlatform(u) === platform;
  return links.filter(match).join(" | ");
}

/** Ordem de severidade da confiança (a menor "ganha" no resumo do lead). */
const CONFIDENCE_RANK = { baixa: 0, media: 1, alta: 2 };

/** Confiança geral do lead = a MENOR entre as de seus links ("" se não há rede). */
function overallConfidence(lead) {
  const evals = evaluateSocials(lead);
  if (!evals.length) return "";
  return evals.reduce((pior, e) => (CONFIDENCE_RANK[e.confianca] < CONFIDENCE_RANK[pior] ? e.confianca : pior), "alta");
}

/** Links que merecem conferência manual (confiança não-alta = vindos de busca web). */
function linksToReview(lead) {
  return evaluateSocials(lead)
    .filter((e) => e.confianca !== "alta")
    .map((e) => e.url)
    .join(" | ");
}

/**
 * Colunas de redes sociais: uma por plataforma (derivadas de `redes_sociais`),
 * mais duas de validação — a confiança geral e os links a revisar (descobertos
 * por busca web, que podem ser de um homônimo).
 */
const SOCIAL_COLUMNS = [
  { key: "instagram", header: "instagram", value: (r) => socialUrlsFor(r, "instagram") },
  { key: "facebook", header: "facebook", value: (r) => socialUrlsFor(r, "facebook") },
  { key: "linkedin", header: "linkedin", value: (r) => socialUrlsFor(r, "linkedin") },
  { key: "outras_redes", header: "outras_redes", value: (r) => socialUrlsFor(r, "outras") },
  { key: "redes_confianca", header: "redes_confianca", value: (r) => overallConfidence(r) },
  { key: "redes_revisar", header: "redes_revisar", value: (r) => linksToReview(r) },
];

/** Colunas comuns às duas listas. */
const BASE_COLUMNS = [
  { key: "nome", header: "nome" },
  { key: "categoria", header: "categoria" },
  { key: "nota", header: "nota" },
  { key: "avaliacoes", header: "qtd_avaliacoes" },
  { key: "telefone", header: "telefone" },
  { key: "whatsapp", header: "whatsapp" },
  { key: "descricao", header: "descricao" },
  { key: "link_maps", header: "link_maps" },
];

/**
 * Colunas de endereço. O endereço completo vem marcado por padrão; os
 * componentes separados (país, estado, cidade…) ficam disponíveis, porém
 * DESMARCADOS por padrão (`default: false`) — quem quiser a planilha "quebrada"
 * marca no modal de exportação.
 */
const ADDRESS_COLUMNS = [
  { key: "endereco", header: "endereco" },
  { key: "pais", header: "pais", default: false },
  { key: "estado", header: "estado", default: false },
  { key: "cidade", header: "cidade", default: false },
  { key: "bairro", header: "bairro", default: false },
  { key: "logradouro", header: "logradouro", default: false },
  { key: "numero", header: "numero", default: false },
  { key: "cep", header: "cep", default: false },
];

/** Lista "sem site": colunas base + endereço + redes sociais (por plataforma). */
export const COLUMNS_SEM_SITE = [
  ...BASE_COLUMNS.slice(0, 6), // nome..whatsapp
  ...ADDRESS_COLUMNS,
  ...SOCIAL_COLUMNS,
  ...BASE_COLUMNS.slice(6), // descricao, link_maps
];

/** Lista "com site": inclui Site + relatório detalhado de Core Web Vitals. */
export const COLUMNS_COM_SITE = [
  ...BASE_COLUMNS.slice(0, 6), // até whatsapp
  ...ADDRESS_COLUMNS,
  { key: "site", header: "site" },
  ...SOCIAL_COLUMNS,
  // Performance (headline)
  { key: "cwv_score", header: "performance" },
  { key: "cwv_status", header: "status" },
  // Métricas de laboratório (Core Web Vitals e afins)
  { key: "cwv_lcp", header: "lcp" },
  { key: "cwv_fcp", header: "fcp" },
  { key: "cwv_cls", header: "cls" },
  { key: "cwv_tbt", header: "tbt" },
  { key: "cwv_si", header: "speed_index" },
  { key: "cwv_tti", header: "tti" },
  // Demais categorias do Lighthouse
  { key: "score_acessibilidade", header: "acessibilidade" },
  { key: "score_boas_praticas", header: "boas_praticas" },
  { key: "score_seo", header: "seo" },
  // Dados derivados do relatório do PageSpeed
  { key: "audit_score", header: "nota_auditoria" },
  { key: "cwv_campo", header: "crux_campo" },
  { key: "cwv_oportunidades", header: "oportunidades_pagespeed" },
  // Conteúdo do site e referência ao relatório exportado
  { key: "site_emails", header: "emails" },
  { key: "site_texto", header: "texto_site" },
  { key: "relatorio_arquivo", header: "arquivo_relatorio" },
  { key: "descricao", header: "descricao" },
  { key: "link_maps", header: "link_maps" },
];

/**
 * Devolve o conjunto de colunas para a lista pedida.
 * @param {"com-site"|"sem-site"} list
 * @returns {{key: string, header: string, value?: (lead: any) => any}[]}
 */
export function columnsFor(list) {
  return list === "com-site" ? COLUMNS_COM_SITE : COLUMNS_SEM_SITE;
}

/**
 * Filtra as colunas de uma lista mantendo só as chaves pedidas (na ordem
 * canônica). Chaves vazias/ausentes => todas as colunas. Chaves desconhecidas
 * são ignoradas.
 * @param {"com-site"|"sem-site"} list
 * @param {string[]} [keys]
 * @returns {{key: string, header: string, value?: (lead: any) => any}[]}
 */
export function pickColumns(list, keys) {
  const all = columnsFor(list);
  if (!Array.isArray(keys) || !keys.length) return all;
  const wanted = new Set(keys);
  const picked = all.filter((c) => wanted.has(c.key));
  return picked.length ? picked : all;
}
