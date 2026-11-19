/*
 * Indicadores do dashboard (FASE 4). Funções puras, calculadas no
 * servidor e testadas, a partir das mesmas linhas de transacoes e
 * faturas — assim nenhum compromisso é contado duas vezes:
 *
 *   - Compra no cartão é despesa (no mês da fatura), mas NUNCA vira
 *     "conta a pagar" individual: ela é paga pela fatura.
 *   - Pagamento de fatura reduz o "a pagar" e o "disponível", mas não é
 *     despesa nova.
 */

import { DataISO, compararDatas, diferencaDias, fimDoMes, mesDaData } from './datas'
import { adicionarMeses, compararMeses } from './meses'
import { reaisParaCentavos } from './money'
import type { StatusPagamento } from './types'

export interface TransacaoPainel {
  id: string
  nome: string
  tipo: 'receita' | 'despesa'
  valor_estimado: number
  valor_real: number | null
  mes_referencia: string
  categoria_id: number | null
  status_pagamento: StatusPagamento
  data_vencimento: string | null
  fatura_id: string | null
  recorrencia_id: string | null
  parcelamento_id: string | null
}

export interface FaturaPainel {
  id: string
  cartao_id: string
  cartao_nome: string
  mes_referencia: string
  data_vencimento: DataISO
  totalCentavos: number
  pagoCentavos: number
}

const valor = (t: Pick<TransacaoPainel, 'valor_real' | 'valor_estimado'>) =>
  reaisParaCentavos(Number(t.valor_real ?? t.valor_estimado))

const restante = (f: Pick<FaturaPainel, 'totalCentavos' | 'pagoCentavos'>) => Math.max(0, f.totalCentavos - f.pagoCentavos)

export interface ResumoMes {
  receitasCentavos: number
  /** Todas as despesas do mês, inclusive compras no cartão (mês da fatura). */
  despesasCentavos: number
  /** receitas − despesas. */
  saldoPrevistoCentavos: number
  /** Contas (fora do cartão) já pagas + pagamentos das faturas do mês. */
  pagoCentavos: number
  /** Contas pendentes (fora do cartão) + saldo das faturas do mês. */
  aPagarCentavos: number
  /** receitas − pago. */
  disponivelCentavos: number
  contasPendentes: number
  faturasEmAbertoCentavos: number
  porCategoria: Record<1 | 2 | 3, number>
}

export function resumirMes(transacoes: TransacaoPainel[], faturasDoMes: FaturaPainel[]): ResumoMes {
  let receitas = 0
  let despesas = 0
  let pagoContas = 0
  let aPagarContas = 0
  let contasPendentes = 0
  const porCategoria: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 }

  for (const t of transacoes) {
    const v = valor(t)

    if (t.tipo === 'receita') {
      receitas += v
      continue
    }

    despesas += v
    if (t.categoria_id === 1 || t.categoria_id === 2 || t.categoria_id === 3) porCategoria[t.categoria_id] += v

    if (t.fatura_id) continue // paga pela fatura

    if (t.status_pagamento === 'pago') {
      pagoContas += v
    } else {
      aPagarContas += v
      contasPendentes += 1
    }
  }

  const pagoFaturas = faturasDoMes.reduce((total, f) => total + Math.min(f.pagoCentavos, f.totalCentavos), 0)
  const restanteFaturas = faturasDoMes.reduce((total, f) => total + restante(f), 0)

  return {
    receitasCentavos: receitas,
    despesasCentavos: despesas,
    saldoPrevistoCentavos: receitas - despesas,
    pagoCentavos: pagoContas + pagoFaturas,
    aPagarCentavos: aPagarContas + restanteFaturas,
    disponivelCentavos: receitas - pagoContas - pagoFaturas,
    contasPendentes,
    faturasEmAbertoCentavos: restanteFaturas,
    porCategoria,
  }
}

export type OrigemCompromisso = 'recorrente' | 'parcela' | 'avulsa' | 'fatura'

export interface Compromisso {
  chave: string
  tipo: 'conta' | 'fatura'
  origem: OrigemCompromisso
  id: string
  nome: string
  valorCentavos: number
  mes_referencia: string
  /** Data de vencimento; null = só se sabe o mês. */
  data: DataISO | null
  vencida: boolean
  /** Para faturas: id do cartão. */
  cartao_id?: string
}

/**
 * Uma conta é considerada pendente se o status for 'pendente'. Registros
 * antigos (status desconhecido) só contam a partir do mês atual: o app não
 * presume que contas de meses passados ficaram sem pagar.
 */
export function contaEstaPendente(t: Pick<TransacaoPainel, 'status_pagamento' | 'mes_referencia'>, mesHoje: string): boolean {
  if (t.status_pagamento === 'pago') return false
  if (t.status_pagamento === 'pendente') return true
  return compararMeses(t.mes_referencia, mesHoje) >= 0
}

function dataReferencia(c: Compromisso): DataISO {
  return c.data ?? fimDoMes(c.mes_referencia)
}

/** Converte contas pendentes (fora do cartão) e faturas em compromissos. */
export function montarCompromissos(transacoes: TransacaoPainel[], faturas: FaturaPainel[], hoje: DataISO): Compromisso[] {
  const mesHoje = mesDaData(hoje)
  const lista: Compromisso[] = []

  for (const t of transacoes) {
    if (t.tipo !== 'despesa' || t.fatura_id || !contaEstaPendente(t, mesHoje)) continue

    const data = t.data_vencimento
    lista.push({
      chave: `conta:${t.id}`,
      tipo: 'conta',
      origem: t.recorrencia_id ? 'recorrente' : t.parcelamento_id ? 'parcela' : 'avulsa',
      id: t.id,
      nome: t.nome,
      valorCentavos: valor(t),
      mes_referencia: t.mes_referencia,
      data,
      vencida: data ? compararDatas(data, hoje) < 0 : compararMeses(t.mes_referencia, mesHoje) < 0,
    })
  }

  for (const f of faturas) {
    const falta = restante(f)
    if (falta <= 0) continue

    lista.push({
      chave: `fatura:${f.id}`,
      tipo: 'fatura',
      origem: 'fatura',
      id: f.id,
      nome: `Fatura ${f.cartao_nome}`,
      valorCentavos: falta,
      mes_referencia: f.mes_referencia,
      data: f.data_vencimento,
      vencida: compararDatas(f.data_vencimento, hoje) < 0,
      cartao_id: f.cartao_id,
    })
  }

  return lista.sort((a, b) => compararDatas(dataReferencia(a), dataReferencia(b)) || b.valorCentavos - a.valorCentavos)
}

/** Vencidos e os que vencem nos próximos `dias` dias (ou no mês atual, sem data). */
export function proximosVencimentos(compromissos: Compromisso[], hoje: DataISO, dias = 30): Compromisso[] {
  const mesHoje = mesDaData(hoje)
  // Sem data de vencimento, usa o fim do mês como referência.
  return compromissos.filter(
    (c) => c.vencida || c.mes_referencia === mesHoje || diferencaDias(hoje, dataReferencia(c)) <= dias
  )
}

export interface MesFuturo {
  mes: string
  contasCentavos: number
  faturasCentavos: number
  totalCentavos: number
  quantidade: number
}

/** Total comprometido em cada um dos próximos `meses` meses. */
export function compromissosFuturos(compromissos: Compromisso[], mesHoje: string, meses = 6): MesFuturo[] {
  return Array.from({ length: meses }, (_, i) => {
    const mes = adicionarMeses(mesHoje, i + 1)
    const doMes = compromissos.filter((c) => c.mes_referencia === mes)
    const contas = doMes.filter((c) => c.tipo === 'conta').reduce((t, c) => t + c.valorCentavos, 0)
    const faturas = doMes.filter((c) => c.tipo === 'fatura').reduce((t, c) => t + c.valorCentavos, 0)
    return { mes, contasCentavos: contas, faturasCentavos: faturas, totalCentavos: contas + faturas, quantidade: doMes.length }
  })
}
