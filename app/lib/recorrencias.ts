/*
 * Regras de recorrência (espelho em TypeScript das funções SQL da
 * FASE 2). A geração oficial acontece no banco; estas funções servem
 * para prévias na interface e são verificadas por testes contra os
 * mesmos casos do SQL.
 */

import {
  DataISO,
  adicionarDias,
  adicionarMesesData,
  compararDatas,
  formatarDataCurta,
  nomeDiaSemana,
  partes,
} from './datas'

export type Frequencia = 'semanal' | 'mensal' | 'anual'
export type StatusRecorrencia = 'ativa' | 'pausada' | 'encerrada'

export interface RegraRecorrencia {
  frequencia: Frequencia
  intervalo: number
  data_inicio: DataISO
  data_fim: DataISO | null
}

export const FREQUENCIAS: { valor: Frequencia; rotulo: string }[] = [
  { valor: 'semanal', rotulo: 'Semanal' },
  { valor: 'mensal', rotulo: 'Mensal' },
  { valor: 'anual', rotulo: 'Anual' },
]

/** Data da n-ésima ocorrência (n ≥ 0), sempre a partir do início. */
export function dataOcorrencia(regra: Pick<RegraRecorrencia, 'frequencia' | 'intervalo' | 'data_inicio'>, n: number): DataISO {
  const { frequencia, intervalo, data_inicio } = regra

  switch (frequencia) {
    case 'semanal':
      return adicionarDias(data_inicio, 7 * intervalo * n)
    case 'mensal':
      return adicionarMesesData(data_inicio, intervalo * n)
    case 'anual':
      return adicionarMesesData(data_inicio, 12 * intervalo * n)
  }
}

/** Todas as ocorrências entre `de` e `ate` (inclusive), respeitando o fim. */
export function ocorrenciasEntre(regra: RegraRecorrencia, de: DataISO, ate: DataISO, limite = 500): DataISO[] {
  const fim = regra.data_fim && compararDatas(regra.data_fim, ate) < 0 ? regra.data_fim : ate
  const resultado: DataISO[] = []

  for (let n = 0; resultado.length < limite; n++) {
    const data = dataOcorrencia(regra, n)
    if (compararDatas(data, fim) > 0) break
    if (compararDatas(data, de) >= 0) resultado.push(data)
  }

  return resultado
}

/** Próxima ocorrência a partir de `referencia` (inclusive), ou null. */
export function proximaOcorrencia(
  regra: RegraRecorrencia & { status?: StatusRecorrencia },
  referencia: DataISO
): DataISO | null {
  if (regra.status && regra.status !== 'ativa') return null

  for (let n = 0; n < 100_000; n++) {
    const data = dataOcorrencia(regra, n)
    if (regra.data_fim && compararDatas(data, regra.data_fim) > 0) return null
    if (compararDatas(data, referencia) >= 0) return data
  }

  return null
}

const DIAS_NO_PLURAL: Record<string, string> = {
  domingo: 'aos domingos',
  segunda: 'às segundas',
  terça: 'às terças',
  quarta: 'às quartas',
  quinta: 'às quintas',
  sexta: 'às sextas',
  sábado: 'aos sábados',
}

/** Texto amigável: "Mensal · todo dia 10", "A cada 2 semanas · às quartas". */
export function descreverFrequencia(regra: Pick<RegraRecorrencia, 'frequencia' | 'intervalo' | 'data_inicio'>): string {
  const { frequencia, intervalo, data_inicio } = regra
  const { dia } = partes(data_inicio)
  const diaSemana = nomeDiaSemana(data_inicio)
  const plural = intervalo > 1

  switch (frequencia) {
    case 'semanal':
      return `${plural ? `A cada ${intervalo} semanas` : 'Semanal'} · ${DIAS_NO_PLURAL[diaSemana]}`
    case 'mensal':
      return `${plural ? `A cada ${intervalo} meses` : 'Mensal'} · todo dia ${dia}`
    case 'anual':
      return `${plural ? `A cada ${intervalo} anos` : 'Anual'} · ${formatarDataCurta(data_inicio)}`
  }
}

/**
 * Até onde gerar ocorrências ao consultar um mês: o fim do mês
 * visualizado e, no mínimo, 3 meses à frente de hoje (para os
 * compromissos futuros). Limitado a 10 anos à frente.
 */
export function horizonteGeracao(mesVisualizado: string, dataHoje: DataISO): DataISO {
  const minimo = fimDoMesDe(adicionarMesesData(dataHoje, 3))
  const visualizado = fimDoMesDe(`${mesVisualizado}-01`)
  const teto = adicionarMesesData(dataHoje, 120)

  const maior = compararDatas(visualizado, minimo) > 0 ? visualizado : minimo
  return compararDatas(maior, teto) > 0 ? teto : maior
}

function fimDoMesDe(data: DataISO): DataISO {
  const { ano, mes } = partes(data)
  return adicionarDias(adicionarMesesData(`${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-01`, 1), -1)
}

/** Valor mensal equivalente (para totais): semanal × 52/12, anual ÷ 12. */
export function valorMensalEquivalenteCentavos(
  regra: Pick<RegraRecorrencia, 'frequencia' | 'intervalo'>,
  valorCentavos: number
): number {
  const porPeriodo = valorCentavos / regra.intervalo
  switch (regra.frequencia) {
    case 'semanal':
      return Math.round((porPeriodo * 52) / 12)
    case 'mensal':
      return Math.round(porPeriodo)
    case 'anual':
      return Math.round(porPeriodo / 12)
  }
}
