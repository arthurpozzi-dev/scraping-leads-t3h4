/**
 * Monta o pacote de exportação (.zip): uma pasta por busca, com as planilhas
 * (com-site / sem-site) nos formatos e colunas escolhidos, e os relatórios dos
 * sites enriquecidos em HTML e/ou PDF.
 *
 * É configurável (ver `build`): o chamador decide listas, formatos, colunas e
 * relatórios. Os padrões reproduzem o comportamento antigo (ambas as listas em
 * CSV + relatórios HTML), então quem chamava `build(buscas)` continua igual.
 *
 * A coluna "Arquivo Relatório" de cada lead enriquecido é preenchida AQUI, no
 * momento da exportação, apontando para o arquivo correspondente dentro do ZIP.
 */
import JSZip from "jszip";

import { toCSV } from "./csvExporter.js";
import { toXLSX } from "./xlsxExporter.js";
import { pickColumns } from "./columns.js";
import { slugify } from "./slug.js";
import { getReportLocale } from "../../application/reportI18n/index.js";

/**
 * Expande leads com VÁRIOS e-mails em uma linha por e-mail (duplicando o resto
 * dos dados do lead). Leads com 0 ou 1 e-mail passam intactos.
 * @param {Array<Record<string, any>>} rows
 * @returns {Array<Record<string, any>>}
 */
function expandByEmail(rows) {
  const out = [];
  for (const lead of rows) {
    const emails = String(lead.site_emails || "")
      .split(" | ")
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length <= 1) {
      out.push(lead);
      continue;
    }
    for (const email of emails) out.push({ ...lead, site_emails: email });
  }
  return out;
}

export class ExportBundle {
  /**
   * @param {Object} deps
   * @param {import("../report/AuditReportRenderer.js").AuditReportRenderer} deps.reportRenderer
   */
  constructor({ reportRenderer }) {
    this.reportRenderer = reportRenderer;
  }

  /**
   * @param {Array<{ query:string, comSite:any[], semSite:any[] }>} buscas
   * @param {Object} [options]
   * @param {Array<"com-site"|"sem-site">} [options.lists=["com-site","sem-site"]] listas a exportar
   * @param {Array<"csv"|"xlsx">} [options.formats=["csv"]] formatos das planilhas
   * @param {{ "com-site"?: string[], "sem-site"?: string[] }} [options.columns] colunas por lista (vazio = todas)
   * @param {"none"|"html"|"pdf"|"both"} [options.reports="html"] relatórios a incluir
   * @param {{ render:(html:string)=>Promise<Buffer> }} [options.pdfRenderer] necessário p/ PDF
   * @param {string} [options.locale] idioma dos relatórios (ex.: "pt-BR", "en-US")
   * @param {boolean} [options.onlyWithEmail=false] exporta só leads com `site_emails` preenchido
   * @param {boolean} [options.combined=false] junta TODAS as buscas numa planilha só (por lista), na raiz do ZIP
   * @param {boolean} [options.oneEmailPerRow=false] duplica o lead (1 e-mail por linha) quando há vários e-mails
   * @param {string[]|null} [options.statuses=null] filtra a lista "com site" por `cwv_status` (ex.: ["BOM","FORA DO AR"]); `null`/vazio = todos. "N/A" cobre leads não medidos
   * @returns {Promise<{ buffer: Buffer, totalReports: number }>}
   */
  async build(buscas, options = {}) {
    const {
      lists = ["com-site", "sem-site"],
      formats = ["csv"],
      columns = null,
      reports = "html",
      pdfRenderer = null,
      locale = undefined,
      onlyWithEmail = false,
      combined = false,
      oneEmailPerRow = false,
      statuses = null,
    } = options;

    const hasEmail = (lead) => String(lead.site_emails || "").trim() !== "";
    const keep = (rows) => (onlyWithEmail ? rows.filter(hasEmail) : rows);

    // Filtro por status de performance — só faz sentido na lista "com site"
    // (a "sem site" nunca é medida). Leads não medidos (status vazio) contam
    // como "N/A".
    const statusOf = (lead) => {
      const s = String(lead.cwv_status || "").trim();
      return s === "" ? "N/A" : s;
    };
    const allowedStatus =
      Array.isArray(statuses) && statuses.length ? new Set(statuses) : null;
    const keepCom = (rows) => {
      const base = keep(rows);
      return allowedStatus ? base.filter((l) => allowedStatus.has(statusOf(l))) : base;
    };

    const wantHtml = reports === "html" || reports === "both";
    const wantPdf = (reports === "pdf" || reports === "both") && !!pdfRenderer;

    // Termos de nome de arquivo no idioma escolhido (pasta de relatórios,
    // prefixo do relatório, nomes das planilhas).
    const f = getReportLocale(locale).files;
    const reportsDir = f.reportsDir;

    const zip = new JSZip();
    let totalReports = 0;

    // Gera os relatórios (HTML/PDF) dos leads "com site" numa pasta e devolve a
    // lista com a coluna `relatorio_arquivo` apontando para o arquivo no ZIP.
    // `usedFiles` é compartilhável para evitar colisões de nome no modo combinado.
    const processComSite = async (leads, folder, usedFiles = new Map()) => {
      const out = [];
      for (const lead of leads) {
        if (!lead.cwv_report || reports === "none") {
          out.push({ ...lead, relatorio_arquivo: "" });
          continue;
        }
        let base = `${f.reportPrefix}-${slugify(lead.nome, "lead")}`;
        const c = (usedFiles.get(base) || 0) + 1;
        usedFiles.set(base, c);
        if (c > 1) base = `${base}-${c}`;

        const html = this.reportRenderer.render(lead, { locale });
        let ref = "";
        if (wantHtml) {
          folder.file(`${reportsDir}/${base}.html`, html);
          ref = `${reportsDir}/${base}.html`;
        }
        if (wantPdf) {
          // O PDF depende de um Chromium renderizando um template com CDNs
          // (Tailwind/Iconify/Fontes); sob carga ou rede instável uma página
          // pode falhar. Tentamos com 1 retry e, se ainda assim falhar, caímos
          // para o HTML — assim o lead nunca fica sem relatório (célula vazia).
          let pdf = null;
          for (let attempt = 0; attempt < 2 && !pdf; attempt++) {
            try {
              pdf = await pdfRenderer.render(html);
            } catch (e) {
              if (attempt === 1)
                console.warn(`[export] PDF falhou para "${lead.nome}": ${e?.message || e}`);
            }
          }
          if (pdf) {
            folder.file(`${reportsDir}/${base}.pdf`, pdf);
            if (!ref) ref = `${reportsDir}/${base}.pdf`;
          } else if (!ref) {
            // Fallback: grava o HTML para não perder o relatório deste lead.
            folder.file(`${reportsDir}/${base}.html`, html);
            ref = `${reportsDir}/${base}.html`;
          }
        }
        totalReports++;
        out.push({ ...lead, relatorio_arquivo: ref });
      }
      return out;
    };

    // Escreve as planilhas de cada lista (formatos/colunas escolhidos). Quando
    // `prependCol` é dado, ele entra como 1ª coluna (ex.: a origem da busca).
    const writeSheets = async (folder, rowsByList, prependCol = null) => {
      for (const list of lists) {
        let rows = rowsByList[list];
        if (!rows) continue;
        if (oneEmailPerRow) rows = expandByEmail(rows);
        let cols = pickColumns(list, columns?.[list]);
        if (prependCol) cols = [prependCol, ...cols];
        const { file: listFile, label: listLabel } = f.list[list];
        if (formats.includes("csv")) folder.file(`${listFile}.csv`, toCSV(rows, cols));
        if (formats.includes("xlsx")) {
          const buf = await toXLSX(rows, cols, listLabel);
          folder.file(`${listFile}.xlsx`, Buffer.from(buf));
        }
      }
    };

    if (combined) {
      // Modo combinado: uma planilha por lista, na raiz, com todas as buscas.
      // A coluna "Busca" identifica de qual pesquisa cada lead veio.
      const comSiteAll = [];
      const semSiteAll = [];
      const usedFiles = new Map();
      for (const busca of buscas) {
        const comSite = await processComSite(keepCom(busca.comSite), zip, usedFiles);
        for (const r of comSite) comSiteAll.push({ ...r, busca: busca.query });
        for (const r of keep(busca.semSite)) semSiteAll.push({ ...r, busca: busca.query });
      }
      await writeSheets(
        zip,
        { "com-site": comSiteAll, "sem-site": semSiteAll },
        { key: "busca", header: "busca" }
      );
    } else {
      // Modo padrão: uma pasta por busca.
      const usedFolders = new Map();
      for (const busca of buscas) {
        let folderName = slugify(busca.query, "busca");
        const fn = (usedFolders.get(folderName) || 0) + 1;
        usedFolders.set(folderName, fn);
        if (fn > 1) folderName = `${folderName}-${fn}`;
        const folder = zip.folder(folderName);

        const comSite = await processComSite(keepCom(busca.comSite), folder);
        await writeSheets(folder, { "com-site": comSite, "sem-site": keep(busca.semSite) });
      }
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    return { buffer, totalReports };
  }
}
