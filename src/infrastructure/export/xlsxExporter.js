/**
 * Exportador XLSX (ExcelJS). Gera uma planilha formatada com cabeçalho
 * destacado, congelado e com auto-filtro.
 */
import ExcelJS from "exceljs";

/** Larguras maiores para colunas que costumam ter texto longo. */
const WIDE_KEYS = new Set([
  "link_maps", "site", "descricao", "endereco",
  "instagram", "facebook", "linkedin", "outras_redes",
]);

/** Valor de uma célula: derivado (`column.value`) ou lido direto de `row[key]`. */
const cellValue = (column, row) => (column.value ? column.value(row) : row[column.key]);

/**
 * @param {Array<Record<string, any>>} rows
 * @param {{key: string, header: string, value?: (row: any) => any}[]} columns
 * @param {string} [sheetName="Leads"]
 * @returns {Promise<ArrayBuffer>}
 */
export async function toXLSX(rows, columns, sheetName = "Leads") {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Maps Leads Scraper · T3H4";
  const ws = wb.addWorksheet(sheetName);

  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: WIDE_KEYS.has(c.key) ? 45 : 22,
  }));

  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF111111" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5FF00" } };
    cell.alignment = { vertical: "middle" };
  });
  ws.getRow(1).height = 22;

  rows.forEach((r) =>
    ws.addRow(columns.reduce((o, c) => ((o[c.key] = cellValue(c, r)), o), {}))
  );
  ws.autoFilter = { from: "A1", to: { row: 1, column: columns.length } };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}
