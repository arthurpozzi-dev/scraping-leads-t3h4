/**
 * Entidade de domínio: Lead (um estabelecimento coletado do Google Maps).
 *
 * Este módulo contém SÓ regras puras: normalização de texto, parse de números
 * (nota/avaliações), formatação de telefone e geração do link de WhatsApp.
 * Nada aqui faz I/O (nem rede, nem disco, nem browser).
 */

/** Colapsa espaços e remove pontas em branco. */
export const clean = (s) => (s || "").toString().replace(/\s+/g, " ").trim();

/**
 * Converte a nota textual ("4,7" / "4.7") em número.
 * @param {string|number} value
 * @returns {number|null} a nota (ex.: 4.7) ou null se não houver.
 */
export function parseRating(value) {
  if (typeof value === "number") return value;
  const m = clean(value).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Converte a quantidade de avaliações ("(1.234)" / "1,234" / "98") em número
 * inteiro. Lida com separador de milhar PT-BR (ponto) e EN (vírgula).
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseReviews(value) {
  if (typeof value === "number") return value;
  const digits = clean(value).replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mantém apenas dígitos de um telefone.
 * @param {string} phone
 * @returns {string}
 */
export function onlyDigits(phone) {
  return clean(phone).replace(/\D/g, "");
}

/**
 * Gera o link de WhatsApp (wa.me) a partir de um telefone brasileiro, QUANDO
 * ele for um celular (DDD + 9 dígitos começando em 9).
 *
 * Heurística: o Google Maps não informa se um número tem WhatsApp. Assumimos
 * que celulares têm. Telefones fixos retornam "".
 *
 * @param {string} phone telefone em qualquer formato
 * @returns {string} URL https://wa.me/55XXXXXXXXXXX ou "".
 */
export function toWhatsAppLink(phone) {
  let d = onlyDigits(phone);
  if (!d) return "";
  // Remove o código do país, se já vier com 55.
  if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("55")) d = d.slice(2); // fixo com DDI
  // Celular BR: 11 dígitos (2 do DDD + 9 + 8). O primeiro do número é 9.
  const isMobile = d.length === 11 && d[2] === "9";
  if (!isMobile) return "";
  return `https://wa.me/55${d}`;
}

/**
 * Normaliza um telefone para exibição, de forma GENÉRICA (multipaís).
 *
 * O Google Maps já entrega o número formatado conforme o país do lugar
 * (ex.: "(16) 99999-9999" no Brasil, "+1 213-373-4253" nos EUA, "+44 20 7946
 * 0958" no Reino Unido). Por isso preservamos esse formato — só colapsamos os
 * espaços — em vez de impor a máscara brasileira, que quebrava números
 * estrangeiros (um número dos EUA com 11 dígitos virava "(12) 13373-4253").
 * @param {string} phone
 * @returns {string}
 */
export function formatPhone(phone) {
  return clean(phone);
}

/** UFs brasileiras (para reconhecer o "estado" no fim do endereço). */
const UF_SET = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

/** Países reconhecidos quando aparecem no fim do endereço (Maps às vezes os inclui). */
const KNOWN_COUNTRIES = new Set([
  "brasil", "brazil", "portugal", "argentina", "paraguai", "uruguai", "chile",
  "bolívia", "bolivia", "peru", "colômbia", "colombia", "estados unidos",
  "united states", "espanha", "españa", "méxico", "mexico",
]);

/**
 * Separa um endereço do Google Maps (pt-BR) em componentes. É BEST-EFFORT: o
 * endereço completo é sempre preservado em `endereco`; os campos derivados
 * (país, estado, cidade, bairro, logradouro, número, CEP) são preenchidos quando
 * o formato é reconhecível. Formato típico do Maps:
 *   "Logradouro, Número - Bairro, Cidade - UF, CEP[, País]"
 * @param {string} raw
 * @returns {{ endereco:string, logradouro:string, numero:string, bairro:string, cidade:string, estado:string, cep:string, pais:string }}
 */
export function parseAddress(raw) {
  const full = clean(raw);
  const out = {
    endereco: full, logradouro: "", numero: "", bairro: "",
    cidade: "", estado: "", cep: "", pais: "",
  };
  if (!full) return out;

  let segs = full.split(",").map((s) => s.trim()).filter(Boolean);

  // CEP (00000-000 ou 00000000) — pode estar em qualquer segmento.
  for (let i = 0; i < segs.length; i++) {
    const m = segs[i].match(/\d{5}-?\d{3}/);
    if (m) {
      out.cep = m[0].replace(/^(\d{5})-?(\d{3})$/, "$1-$2");
      segs[i] = segs[i].replace(m[0], "").trim();
      break;
    }
  }
  segs = segs.filter(Boolean);

  // País: último segmento, se for um país conhecido.
  if (segs.length && KNOWN_COUNTRIES.has(segs[segs.length - 1].toLowerCase())) {
    out.pais = segs.pop();
  }

  // "Cidade - UF": último segmento com " - " cuja parte direita é uma UF.
  for (let i = segs.length - 1; i >= 0; i--) {
    const idx = segs[i].lastIndexOf(" - ");
    if (idx === -1) continue;
    const right = segs[i].slice(idx + 3).trim();
    if (UF_SET.has(right.toUpperCase())) {
      out.estado = right.toUpperCase();
      out.cidade = segs[i].slice(0, idx).trim();
      segs.splice(i, 1);
      break;
    }
  }

  // "Número - Bairro": segmento que começa por número e tem " - ".
  for (let i = 0; i < segs.length; i++) {
    const idx = segs[i].indexOf(" - ");
    if (idx === -1) continue;
    const left = segs[i].slice(0, idx).trim();
    if (/^\d+[A-Za-z]?$/.test(left)) {
      out.numero = left;
      out.bairro = segs[i].slice(idx + 3).trim();
      segs.splice(i, 1);
      break;
    }
  }

  // Logradouro: primeiro segmento restante.
  if (segs.length) out.logradouro = segs.shift();
  // Número avulso logo após o logradouro (ex.: "Av. X, 123, Bairro").
  if (!out.numero && segs.length && /^\d+[A-Za-z]?$/.test(segs[0])) out.numero = segs.shift();
  // Bairro: o que sobrar, se ainda não preenchido.
  if (!out.bairro && segs.length) out.bairro = segs.join(", ");
  // País padrão quando há UF brasileira mas o Maps não trouxe o país.
  if (!out.pais && out.estado) out.pais = "Brasil";

  return out;
}

/**
 * @typedef {Object} Lead
 * @property {string} nome
 * @property {string} categoria
 * @property {number|null} nota             Avaliação (ex.: 4.7)
 * @property {number|null} avaliacoes       Quantidade de avaliações
 * @property {string} telefone              Telefone formatado
 * @property {string} whatsapp              Link wa.me (se celular)
 * @property {string} site                  Site próprio (preenchido após a separação)
 * @property {string} site_bruto            Link cru do campo "site" do Maps (candidato)
 * @property {string} redes_sociais         Links de redes sociais / agregadores (separados por " | ")
 * @property {string} link_maps             Link do Google Maps / Meu Negócio
 * @property {string} descricao             Descrição, se houver
 * @property {number|null} cwv_score        Pontuação Core Web Vitals (0–100), pós-enriquecimento
 * @property {string} cwv_status            RUIM / MÉDIO / BOM / N/A, pós-enriquecimento
 */

/**
 * Cria um Lead normalizado a partir de dados crus extraídos do scraper.
 * Garante que todos os campos existam e tenham o tipo correto.
 * @param {Partial<Lead> & Record<string, any>} raw
 * @returns {Lead}
 */
export function createLead(raw = {}) {
  const telefoneFmt = formatPhone(raw.telefone);
  const addr = parseAddress(raw.endereco);
  return {
    nome: clean(raw.nome),
    categoria: clean(raw.categoria),
    nota: typeof raw.nota === "number" ? raw.nota : parseRating(raw.nota),
    avaliacoes:
      typeof raw.avaliacoes === "number" ? raw.avaliacoes : parseReviews(raw.avaliacoes),
    telefone: telefoneFmt,
    whatsapp: clean(raw.whatsapp) || toWhatsAppLink(telefoneFmt),
    // Endereço completo + componentes derivados (best-effort).
    endereco: addr.endereco,
    logradouro: addr.logradouro,
    numero: addr.numero,
    bairro: addr.bairro,
    cidade: addr.cidade,
    estado: addr.estado,
    cep: addr.cep,
    pais: addr.pais,
    site: clean(raw.site),
    site_bruto: clean(raw.site_bruto || raw.site),
    redes_sociais: clean(raw.redes_sociais),
    link_maps: clean(raw.link_maps),
    descricao: clean(raw.descricao),
    cwv_score: typeof raw.cwv_score === "number" ? raw.cwv_score : null,
    cwv_status: clean(raw.cwv_status),
  };
}

/**
 * Indica se um Lead tem algum dado de contato útil (telefone, site/redes ou link do Maps).
 * Usado pela limpeza para descartar leads "vazios".
 * @param {Lead} lead
 * @returns {boolean}
 */
export function hasUsefulContact(lead) {
  return Boolean(
    lead.telefone || lead.site_bruto || lead.redes_sociais || lead.link_maps
  );
}

/**
 * Extrai o identificador único do lugar (CID/feature id, ex.: "0xabc:0xdef")
 * de um link do Google Maps. Esse id é estável por estabelecimento: dois cards
 * do MESMO lugar têm o mesmo id, lugares diferentes têm ids diferentes — por
 * isso é a melhor chave de deduplicação.
 * @param {string} url
 * @returns {string} o id, ou "" se não encontrar.
 */
export function extractPlaceId(url) {
  const decoded = decodeURIComponent(url || "");
  const m = decoded.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
  return m ? m[0].toLowerCase() : "";
}
