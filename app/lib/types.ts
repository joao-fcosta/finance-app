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
  /** Recorrência que gerou esta ocorrência (FASE 2). */
  recorrencia_id: string | null
  /** Data de vencimento "YYYY-MM-DD" (ocorrências de recorrências). */
  data_vencimento: string | null
  /** FASE 3: forma de pagamento e vínculo com cartão/fatura. */
  forma_pagamento: FormaPagamentoTransacao | null
  cartao_id: string | null
  fatura_id: string | null
  data_compra: string | null
  created_at: string
}

export type FormaPagamentoTransacao = 'dinheiro' | 'pix' | 'debito' | 'credito'

export interface Cartao {
  id: string
  nome: string
  bandeira: string | null
  limite: number
  dia_fechamento: number
  dia_vencimento: number
  ativo: boolean
}

export interface FaturaResumo {
  id: string
  cartao_id: string
  mes_referencia: string
  data_fechamento: string
  data_vencimento: string
  totalCentavos: number
  pagoCentavos: number
  quantidadeCompras: number
}

export interface CartaoComResumo extends Cartao {
  comprasCentavos: number
  pagamentosCentavos: number
  faturas: FaturaResumo[]
}

export interface CompraFatura {
  id: string
  nome: string
  valor_estimado: number
  valor_real: number | null
  categoria_id: number | null
  data_compra: string | null
  numero_parcela: number | null
  parcelamento_id: string | null
  recorrencia_id: string | null
}

export interface PagamentoFatura {
  id: string
  valor: number
  data_pagamento: string
}

export interface FaturaDetalhada extends FaturaResumo {
  compras: CompraFatura[]
  pagamentos: PagamentoFatura[]
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

export interface Recorrencia {
  id: string
  nome: string
  tipo: TipoTransacao
  categoria_id: number | null
  valor: number
  frequencia: 'semanal' | 'mensal' | 'anual'
  intervalo: number
  data_inicio: string
  data_fim: string | null
  status: 'ativa' | 'pausada' | 'encerrada'
  forma_pagamento?: FormaPagamentoTransacao | null
  cartao_id?: string | null
  created_at: string
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
