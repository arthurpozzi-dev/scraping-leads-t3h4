/**
 * Garante que um lead tenha um relatório de laboratório (Lighthouse) completo
 * antes de gerar o relatório persuasivo.
 *
 * No modo rápido de enriquecimento (CrUX), o lead fica com `cwv_report: null` —
 * basta ter o score de campo. Quando o usuário pede o relatório de UM lead, aqui
 * rodamos o Lighthouse completo sob demanda e guardamos no próprio lead, para que
 * renders seguintes sejam instantâneos.
 *
 * @param {{ site?: string, cwv_report?: any }} lead
 * @param {{ analyze: (url:string)=>Promise<any> }} pageSpeedClient  cliente de 4 categorias
 * @returns {Promise<any|null>} o relatório (existente ou recém-gerado), ou null se não houver site.
 */
export async function ensureFullReport(lead, pageSpeedClient) {
  if (lead.cwv_report) return lead.cwv_report;
  if (!lead.site) return null;
  lead.cwv_report = await pageSpeedClient.analyze(lead.site);
  return lead.cwv_report;
}
