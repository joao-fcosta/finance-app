/*
 * Regras de cartão de crédito e faturas (espelho em TypeScript das
 * funções SQL da FASE 3). O cálculo oficial da fatura de uma compra é
 * feito no banco; estas funções alimentam prévias e resumos na interface
 * e são testadas contra os mesmos casos do SQL.
 */

import { DataISO, compararDatas, dataNoMes, partes } from './datas'

export interface RegraCartao {
  dia_fechamento: number
  dia_vencimento: number
}

export interface CicloFatura {
  /** Mês da fatura = mês do vencimento ("YYYY-MM"). */
  mes_referencia: string
  data_fechamento: DataISO
  data_vencimento: DataISO
}

function dataNoIndice(indice: number, dia: number): DataISO {
  return dataNoMes(Math.floor(indice / 12), (indice % 12) + 1, dia)
}

/**
 * Fatura de uma compra feita em `data`. Compra ANTES do dia de
 * fechamento entra na fatura que fecha naquele mês; no dia do
 * fechamento ou depois, na seguinte. `deslocamento` avança ciclos
 * (parcela i usa i - 1).
 */
export function cicloDaCompra(cartao: RegraCartao, data: DataISO, deslocamento = 0): CicloFatura {
  const { ano, mes } = partes(data)
  const indiceCompra = ano * 12 + (mes - 1)
  const fechamentoNoMes = dataNoIndice(indiceCompra, cartao.dia_fechamento)

  const indiceFechamento = indiceCompra + (compararDatas(data, fechamentoNoMes) >= 0 ? 1 : 0) + deslocamento
  const indiceVencimento = indiceFechamento + (cartao.dia_vencimento > cartao.dia_fechamento ? 0 : 1)

  const data_vencimento = dataNoIndice(indiceVencimento, cartao.dia_vencimento)

  return {
    mes_referencia: data_vencimento.slice(0, 7),
    data_fechamento: dataNoIndice(indiceFechamento, cartao.dia_fechamento),
    data_vencimento,
  }
}

/** Ciclos de cada parcela de uma compra parcelada. */
export function ciclosDasParcelas(cartao: RegraCartao, data: DataISO, quantidade: number): CicloFatura[] {
  return Array.from({ length: quantidade }, (_, i) => cicloDaCompra(cartao, data, i))
}

export type StatusFatura = 'aberta' | 'fechada' | 'parcial' | 'paga' | 'vencida' | 'vazia'

export interface ValoresFatura {
  data_fechamento: DataISO
  data_vencimento: DataISO
  totalCentavos: number
  pagoCentavos: number
}

/**
 * Status derivado (nunca gravado):
 * - vazia:   sem compras nem pagamentos.
 * - paga:    pagamentos cobrem o total.
 * - aberta:  ainda não fechou (aceita compras).
 * - vencida: passou do vencimento sem quitar.
 * - parcial: fechada, com pagamento parcial.
 * - fechada: fechada, sem pagamento.
 */
export function statusFatura(fatura: ValoresFatura, hoje: DataISO): StatusFatura {
  if (fatura.totalCentavos <= 0 && fatura.pagoCentavos <= 0) return 'vazia'
  if (fatura.totalCentavos > 0 && fatura.pagoCentavos >= fatura.totalCentavos) return 'paga'
  if (compararDatas(hoje, fatura.data_fechamento) < 0) return 'aberta'
  if (compararDatas(hoje, fatura.data_vencimento) > 0) return 'vencida'
  return fatura.pagoCentavos > 0 ? 'parcial' : 'fechada'
}

export function restanteFaturaCentavos(fatura: Pick<ValoresFatura, 'totalCentavos' | 'pagoCentavos'>): number {
  return Math.max(0, fatura.totalCentavos - fatura.pagoCentavos)
}

/**
 * Limite: compras no cartão (inclusive parcelas futuras) consomem o
 * limite no momento da compra; pagamentos de fatura liberam.
 */
export function limiteCartao(limiteCentavos: number, comprasCentavos: number, pagamentosCentavos: number) {
  const utilizado = Math.max(0, comprasCentavos - pagamentosCentavos)
  return {
    utilizadoCentavos: utilizado,
    disponivelCentavos: limiteCentavos - utilizado,
    percentualUtilizado: limiteCentavos > 0 ? Math.min(100, Math.round((utilizado / limiteCentavos) * 100)) : 0,
    acimaDoLimite: utilizado > limiteCentavos,
  }
}

export const ROTULO_STATUS_FATURA: Record<StatusFatura, string> = {
  aberta: 'Aberta',
  fechada: 'Fechada',
  parcial: 'Paga parcialmente',
  paga: 'Paga',
  vencida: 'Vencida',
  vazia: 'Sem compras',
}

export const FORMAS_PAGAMENTO = [
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'debito', rotulo: 'Débito' },
  { valor: 'dinheiro', rotulo: 'Dinheiro' },
  { valor: 'credito', rotulo: 'Crédito' },
] as const

export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number]['valor']
