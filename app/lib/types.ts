/*
 * Tipos compartilhados entre client e server.
 */

export type TipoTransacao = 'receita' | 'despesa'

/**
 * Estado de pagamento de uma transação.
 *
 * - 'pendente': ainda não paga.
 * - 'pago': paga (ver `pago_em`).
 * - null: registro anterior à FASE 1. Não sabemos se foi pago,
 *   então o sistema NÃO presume nenhum dos dois estados.
 */
export type StatusPagamento = 'pendente' | 'pago' | null

export interface Transacao {
  id: string
  nome: string
  mes_referencia: string
  valor_estimado: number
  valor_real: number | null
  tipo: TipoTransacao
  categoria_id: number | null
  parcelamento_id: string | null
  numero_parcela: number | null
  status_pagamento: StatusPagamento
  pago_em: string | null
  created_at: string
}

export interface Parcela {
  id: string
  nome: string
  mes_referencia: string
  valor_estimado: number
  valor_real: number | null
  tipo: TipoTransacao
  categoria_id: number | null
  numero_parcela: number | null
  status_pagamento: StatusPagamento
  pago_em: string | null
}

export interface ParcelamentoComParcelas {
  id: string
  nome: string
  total_parcelas: number
  /** Soma atual das parcelas (recalculada pelas operações). */
  valor_total: number
  /** Valor original da compra (não é recalculado). */
  valor_contratado: number | null
  parcelas: Parcela[]
}

/** Escopo de edição de uma parcela. */
export type EscopoEdicao = 'unica' | 'futuras'

export const CATEGORIAS = [
  { id: 1, nome: 'Necessidades', meta: 50 },
  { id: 2, nome: 'Estilo de vida', meta: 30 },
  { id: 3, nome: 'Projetos e poupança', meta: 20 },
] as const

export function nomeCategoria(categoriaId: number | null): string | null {
  return CATEGORIAS.find((categoria) => categoria.id === categoriaId)?.nome ?? null
}

/** Remove o sufixo "(3/12)" adicionado aos nomes das parcelas. */
export function nomeBaseParcela(nome: string): string {
  return nome.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim()
}
