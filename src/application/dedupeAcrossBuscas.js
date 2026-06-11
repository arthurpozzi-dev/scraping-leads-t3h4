/**
 * Caso de uso: DEDUPLICAÇÃO ENTRE BUSCAS.
 *
 * O `cleanLeads` remove duplicatas DENTRO de cada busca. Mas o mesmo
 * estabelecimento pode aparecer em pesquisas diferentes (ex.: "dentistas em
 * Campinas" e "ortodontistas em Campinas") — e, ao juntar tudo numa planilha só,
 * ele viria repetido.
 *
 * Esta etapa varre TODAS as buscas em ordem, mantém a PRIMEIRA ocorrência de
 * cada estabelecimento e descarta as repetidas das buscas seguintes. Usa a mesma
 * chave do `cleanLeads` (place-id do Maps; na falta, nome + telefone), então só
 * remove quando é de fato o mesmo lugar.
 *
 * Deve rodar logo após a coleta — ANTES do enriquecimento (PageSpeed) e do
 * scraping de e-mails — para não gastar essas etapas (caras) em duplicatas.
 *
 * Muta as buscas recebidas (filtra `comSite`/`semSite` e ajusta os contadores em
 * `stats`) e devolve quantos leads foram removidos.
 */
import { dedupeKey } from "./CleanLeads.js";

/**
 * @param {Array<{ query:string, comSite:any[], semSite:any[], stats?:Record<string,number> }>} buscas
 * @returns {{ buscas: typeof buscas, removed: number }}
 */
export function dedupeAcrossBuscas(buscas = []) {
  const seen = new Set();
  let removed = 0;

  const filterList = (rows = []) =>
    rows.filter((lead) => {
      const key = dedupeKey(lead);
      if (seen.has(key)) {
        removed++;
        return false;
      }
      seen.add(key);
      return true;
    });

  for (const busca of buscas) {
    // "com site" antes de "sem site": se o mesmo lugar aparecer nas duas
    // classificações (raro), preferimos manter a versão com site.
    busca.comSite = filterList(busca.comSite);
    busca.semSite = filterList(busca.semSite);
    if (busca.stats) {
      busca.stats.comSite = busca.comSite.length;
      busca.stats.semSite = busca.semSite.length;
    }
  }

  return { buscas, removed };
}
