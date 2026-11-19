/*
 * Datas no formato ISO "YYYY-MM-DD", com aritmética inteira (sem Date
 * para cálculo), evitando problemas de fuso horário.
 */

export type DataISO = string

const PADRAO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/
export const FUSO_PADRAO = 'America/Sao_Paulo'

export interface PartesData {
  ano: number
  mes: number // 1-12
  dia: number
}

export function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

export function partes(data: DataISO): PartesData {
  const m = PADRAO_DATA.exec(data)
  if (!m) throw new Error(`Data inválida: "${data}". Use AAAA-MM-DD.`)

  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mes < 1 || mes > 12 || dia < 1 || dia > ultimoDiaDoMes(ano, mes)) {
    throw new Error(`Data inválida: "${data}".`)
  }

  return { ano, mes, dia }
}

export function dataValida(data: string): boolean {
  try {
    partes(data)
    return true
  } catch {
    return false
  }
}

export function montarData(ano: number, mes: number, dia: number): DataISO {
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Data no mês informado, limitando o dia ao último dia do mês. */
export function dataNoMes(ano: number, mes: number, dia: number): DataISO {
  return montarData(ano, mes, Math.min(dia, ultimoDiaDoMes(ano, mes)))
}

function paraDiaJuliano(data: DataISO): number {
  const { ano, mes, dia } = partes(data)
  return Math.round(Date.UTC(ano, mes - 1, dia) / 86_400_000)
}

function deDiaJuliano(n: number): DataISO {
  const d = new Date(n * 86_400_000)
  return montarData(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function adicionarDias(data: DataISO, dias: number): DataISO {
  return deDiaJuliano(paraDiaJuliano(data) + dias)
}

export function diferencaDias(de: DataISO, ate: DataISO): number {
  return paraDiaJuliano(ate) - paraDiaJuliano(de)
}

/**
 * Soma meses mantendo o dia de origem e ajustando para o último dia
 * quando o mês de destino for mais curto (mesma regra do PostgreSQL):
 * 31/01 + 1 mês = 28/02; 31/01 + 2 meses = 31/03.
 */
export function adicionarMesesData(data: DataISO, meses: number): DataISO {
  const { ano, mes, dia } = partes(data)
  const indice = ano * 12 + (mes - 1) + meses
  return dataNoMes(Math.floor(indice / 12), (indice % 12) + 1, dia)
}

export function compararDatas(a: DataISO, b: DataISO): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** "2026-11-10" → "2026-11". */
export function mesDaData(data: DataISO): string {
  return data.slice(0, 7)
}

/** "2026-02" → "2026-02-28". */
export function fimDoMes(mes: string): DataISO {
  const [ano, numero] = mes.split('-').map(Number)
  return montarData(ano, numero, ultimoDiaDoMes(ano, numero))
}

/** "2026-02" → "2026-02-01". */
export function inicioDoMes(mes: string): DataISO {
  return `${mes}-01`
}

/** Hoje no fuso informado (padrão: Brasília), independente do servidor. */
export function hoje(fuso: string = FUSO_PADRAO, agora: Date = new Date()): DataISO {
  const partesData = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora)

  const valor = (tipo: string) => partesData.find((p) => p.type === tipo)?.value ?? ''
  return `${valor('year')}-${valor('month')}-${valor('day')}`
}

/** Dia da semana: 0 = domingo ... 6 = sábado. */
export function diaDaSemana(data: DataISO): number {
  const { ano, mes, dia } = partes(data)
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
}

const NOMES_DIA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const NOMES_MES_CURTO = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.']

export function nomeDiaSemana(data: DataISO): string {
  return NOMES_DIA_SEMANA[diaDaSemana(data)]
}

/** "2026-11-10" → "10/11/2026". */
export function formatarData(data: DataISO): string {
  const { ano, mes, dia } = partes(data)
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`
}

/** "2026-11-10" → "10 nov.". */
export function formatarDataCurta(data: DataISO): string {
  const { mes, dia } = partes(data)
  return `${dia} ${NOMES_MES_CURTO[mes - 1]}`
}

/** Descrição relativa curta: "hoje", "amanhã", "em 3 dias", "há 2 dias". */
export function descreverPrazo(data: DataISO, referencia: DataISO): string {
  const dias = diferencaDias(referencia, data)
  if (dias === 0) return 'hoje'
  if (dias === 1) return 'amanhã'
  if (dias === -1) return 'ontem'
  if (dias > 1) return `em ${dias} dias`
  return `há ${-dias} dias`
}
