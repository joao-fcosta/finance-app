/*
 * Regras de negócio puras (sem I/O) para parcelamentos.
 * Usadas pela UI e cobertas por testes unitários.
 */

import { compararMeses } from './meses'
import { reaisParaCentavos } from './money'
import type { Parcela, ParcelamentoComParcelas } from './types'

/**
 * Situação exibida de uma parcela.
 *
 * - 'paga'       → status_pagamento = 'pago'
 * - 'vencida'    → status 'pendente' e o mês de referência já terminou
 * - 'pendente'   → status 'pendente' e mês atual ou futuro
 * - 'sem_status' → registro antigo (status NULL). Não presumimos que
 *                  foi pago nem que está atrasado.
 */
export type SituacaoParcela = 'paga' | 'pendente' | 'vencida' | 'sem_status'

/**
 * Só temos o MÊS de referência (não o dia de vencimento). Por isso uma
 * parcela só é considerada vencida quando o mês inteiro já passou.
 */
export function situacaoParcela(
  parcela: Pick<Parcela, 'status_pagamento' | 'mes_referencia'>,
  mesAtual: string
): SituacaoParcela {
  if (parcela.status_pagamento === 'pago') {
    return 'paga'
  }

  if (parcela.status_pagamento === null) {
    return 'sem_status'
  }

  return compararMeses(parcela.mes_referencia, mesAtual) < 0 ? 'vencida' : 'pendente'
}

/** Valor efetivo de uma transação, na mesma regra usada no dashboard. */
export function valorEfetivoCentavos(
  parcela: Pick<Parcela, 'valor_real' | 'valor_estimado'>
): number {
  return reaisParaCentavos(Number(parcela.valor_real ?? parcela.valor_estimado))
}

/** Ordena parcelas por número; empata pelo mês. */
export function ordenarParcelas<T extends Pick<Parcela, 'numero_parcela' | 'mes_referencia'>>(
  parcelas: T[]
): T[] {
  return [...parcelas].sort((a, b) => {
    const porNumero = (a.numero_parcela ?? 0) - (b.numero_parcela ?? 0)

    return porNumero !== 0 ? porNumero : compararMeses(a.mes_referencia, b.mes_referencia)
  })
}

export interface ResumoParcelamento {
  totalParcelas: number
  pagas: number
  /** Parcelas não pagas (inclui vencidas e sem status). */
  pendentes: number
  vencidas: number
  semStatus: number
  /** Soma das parcelas existentes. */
  valorTotalCentavos: number
  /** Valor original da compra; null se o banco não informar. */
  valorContratadoCentavos: number | null
  /**
   * valorContratado − soma das parcelas. Diferente de zero quando
   * parcelas foram editadas ou excluídas. null se não houver contratado.
   */
  diferencaContratadoCentavos: number | null
  valorPagoCentavos: number
  valorRestanteCentavos: number
  /** Valor da próxima parcela a pagar (ou da última, se finalizado). */
  valorParcelaCentavos: number
  /** true quando nem todas as parcelas têm o mesmo valor. */
  valoresDiferentes: boolean
  proxima: Parcela | null
  /** 0 a 100, pela quantidade de parcelas pagas. */
  progresso: number
  finalizado: boolean
}

export function resumirParcelamento(
  parcelamento: Pick<ParcelamentoComParcelas, 'parcelas'> &
    Partial<Pick<ParcelamentoComParcelas, 'valor_contratado'>>,
  mesAtual: string
): ResumoParcelamento {
  const parcelas = ordenarParcelas(parcelamento.parcelas)

  let pagas = 0
  let vencidas = 0
  let semStatus = 0
  let valorTotalCentavos = 0
  let valorPagoCentavos = 0
  let proxima: Parcela | null = null
  const valoresDistintos = new Set<number>()

  for (const parcela of parcelas) {
    const valor = valorEfetivoCentavos(parcela)
    const situacao = situacaoParcela(parcela, mesAtual)

    valorTotalCentavos += valor
    valoresDistintos.add(valor)

    if (situacao === 'paga') {
      pagas += 1
      valorPagoCentavos += valor
      continue
    }

    if (situacao === 'vencida') vencidas += 1
    if (situacao === 'sem_status') semStatus += 1

    if (!proxima) {
      proxima = parcela
    }
  }

  const totalParcelas = parcelas.length
  const referencia = proxima ?? parcelas[parcelas.length - 1]
  const valorContratadoCentavos =
    parcelamento.valor_contratado === null || parcelamento.valor_contratado === undefined
      ? null
      : reaisParaCentavos(Number(parcelamento.valor_contratado))

  return {
    totalParcelas,
    pagas,
    pendentes: totalParcelas - pagas,
    vencidas,
    semStatus,
    valorTotalCentavos,
    valorContratadoCentavos,
    diferencaContratadoCentavos:
      valorContratadoCentavos === null ? null : valorContratadoCentavos - valorTotalCentavos,
    valorPagoCentavos,
    valorRestanteCentavos: valorTotalCentavos - valorPagoCentavos,
    valorParcelaCentavos: referencia ? valorEfetivoCentavos(referencia) : 0,
    valoresDiferentes: valoresDistintos.size > 1,
    proxima,
    progresso: totalParcelas > 0 ? Math.round((pagas / totalParcelas) * 100) : 0,
    finalizado: totalParcelas > 0 && pagas === totalParcelas,
  }
}

/** Agrupa parcelas por ano, mantendo a ordem por mês. */
export function agruparParcelasPorAno<T extends Pick<Parcela, 'mes_referencia' | 'numero_parcela'>>(
  parcelas: T[]
): { ano: string; parcelas: T[] }[] {
  const ordenadas = [...parcelas].sort((a, b) => {
    const porMes = compararMeses(a.mes_referencia, b.mes_referencia)

    return porMes !== 0 ? porMes : (a.numero_parcela ?? 0) - (b.numero_parcela ?? 0)
  })

  const grupos: { ano: string; parcelas: T[] }[] = []

  for (const parcela of ordenadas) {
    const ano = parcela.mes_referencia.slice(0, 4)
    const ultimo = grupos[grupos.length - 1]

    if (ultimo && ultimo.ano === ano) {
      ultimo.parcelas.push(parcela)
    } else {
      grupos.push({ ano, parcelas: [parcela] })
    }
  }

  return grupos
}

/**
 * Quantas parcelas uma edição "esta e as próximas" vai alterar.
 * Parcelas pagas nunca são alteradas em lote (preserva o histórico).
 */
export function parcelasAfetadasPorEdicaoFutura<
  T extends Pick<Parcela, 'numero_parcela' | 'status_pagamento'>
>(parcelas: T[], numeroInicial: number): T[] {
  return parcelas.filter(
    (parcela) =>
      (parcela.numero_parcela ?? 0) >= numeroInicial && parcela.status_pagamento !== 'pago'
  )
}
