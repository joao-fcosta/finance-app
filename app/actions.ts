'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { normalizarMes } from '@/app/lib/meses'
import { MAX_CENTAVOS, centavosParaReais, distribuirParcelas, formatarCentavos } from '@/app/lib/money'
import type {
  EscopoEdicao,
  ParcelamentoComParcelas,
  TipoTransacao,
  Transacao,
} from '@/app/lib/types'

async function criarSupabase() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },

        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // O proxy já cuida da atualização das cookies.
          }
        },
      },
    }
  )
}

/*
 * =====================================================
 * INFRAESTRUTURA
 * =====================================================
 *
 * Mutações retornam um Resultado em vez de lançar exceção: em produção
 * o Next.js oculta a mensagem de erros lançados por Server Actions, e o
 * usuário veria apenas um erro genérico.
 */

export type Resultado<T = undefined> =
  | { ok: true; mensagem: string; dados?: T }
  | { ok: false; erro: string }

class ErroValidacao extends Error {}

interface ErroBanco {
  code?: string
  message: string
}

const MAX_PARCELAS = 120

const SELECT_TRANSACAO_BASE = `
  id,
  nome,
  mes_referencia,
  valor_estimado,
  valor_real,
  tipo,
  categoria_id,
  parcelamento_id,
  numero_parcela,
  created_at
`

const SELECT_TRANSACAO = `${SELECT_TRANSACAO_BASE}, status_pagamento, pago_em`

/** Coluna inexistente: a migration da FASE 1 ainda não foi aplicada. */
function colunaInexistente(error: ErroBanco) {
  return error.code === '42703' || /status_pagamento|pago_em|valor_contratado/.test(error.message)
}

/** Função RPC inexistente. */
function funcaoInexistente(error: ErroBanco) {
  return error.code === '42883' || error.code === 'PGRST202'
}

/** Traduz erros do banco para mensagens seguras de exibir. */
function mensagemDoBanco(error: ErroBanco, padrao: string) {
  console.error(padrao, error)

  if (funcaoInexistente(error) || colunaInexistente(error)) {
    return 'O banco de dados está desatualizado. Aplique a migration da FASE 1 no Supabase.'
  }

  // Erros de regra de negócio lançados pelas funções RPC (raise exception
  // com errcode 22023) já têm mensagem pensada para o usuário.
  if (error.code === '22023' || error.code === 'P0002') {
    return error.message
  }

  // numeric_value_out_of_range: soma acima do limite de numeric(10,2).
  if (error.code === '22003') {
    return `O valor excede o limite de ${formatarCentavos(MAX_CENTAVOS)}.`
  }

  // foreign_key_violation: referência a parcelamento inexistente ou de
  // outro usuário (FK composta parcelamento_id + usuario_id).
  if (error.code === '23503') {
    return 'Parcelamento ou categoria não encontrado.'
  }

  return padrao
}

async function executar<T>(
  operacao: () => Promise<Resultado<T>>,
  padrao: string
): Promise<Resultado<T>> {
  try {
    return await operacao()
  } catch (error) {
    if (error instanceof ErroValidacao) {
      return { ok: false, erro: error.message }
    }

    console.error(padrao, error)
    return { ok: false, erro: padrao }
  }
}

async function obterContexto() {
  const supabase = await criarSupabase()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new ErroValidacao('Sua sessão expirou. Entre novamente.')
  }

  return { supabase, user }
}

function validarNome(nome: string) {
  const limpo = nome.trim()

  if (!limpo) {
    throw new ErroValidacao('Informe o nome da transação.')
  }

  if (limpo.length > 120) {
    throw new ErroValidacao('O nome deve ter no máximo 120 caracteres.')
  }

  return limpo
}

function validarCentavos(valorCentavos: number) {
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) {
    throw new ErroValidacao('O valor deve ser maior que zero.')
  }

  if (valorCentavos > MAX_CENTAVOS) {
    throw new ErroValidacao(`O valor máximo é ${formatarCentavos(MAX_CENTAVOS)}.`)
  }

  return valorCentavos
}

function validarMes(mes: string) {
  const normalizado = normalizarMes(mes)

  if (!normalizado) {
    throw new ErroValidacao('Mês de referência inválido.')
  }

  return normalizado
}

function validarCategoria(tipo: TipoTransacao, categoriaId?: number) {
  if (tipo !== 'despesa') {
    return null
  }

  if (categoriaId === undefined || ![1, 2, 3].includes(categoriaId)) {
    throw new ErroValidacao('Selecione uma categoria.')
  }

  return categoriaId
}

/*
 * =====================================================
 * ADICIONAR TRANSAÇÃO
 * =====================================================
 */

interface NovaTransacao {
  nome: string
  /** Valor TOTAL em centavos inteiros. */
  valorCentavos: number
  mesReferencia: string
  tipo: TipoTransacao
  categoriaId?: number
  parcelas?: number
}

export async function adicionarTransacao(
  dados: NovaTransacao
): Promise<Resultado<{ parcelamentoId?: string }>> {
  return executar(async () => {
    const { supabase, user } = await obterContexto()

    if (dados.tipo !== 'receita' && dados.tipo !== 'despesa') {
      throw new ErroValidacao('Tipo de transação inválido.')
    }

    const nome = validarNome(dados.nome)
    const totalCentavos = validarCentavos(dados.valorCentavos)
    const mesReferencia = validarMes(dados.mesReferencia)
    const categoriaId = validarCategoria(dados.tipo, dados.categoriaId)
    const quantidade = dados.parcelas ?? 1

    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_PARCELAS) {
      throw new ErroValidacao(`A quantidade de parcelas deve ser entre 2 e ${MAX_PARCELAS}.`)
    }

    /*
     * Transação simples
     */
    if (quantidade === 1) {
      const { error } = await supabase.from('transacoes').insert({
        usuario_id: user.id,
        nome,
        mes_referencia: mesReferencia,
        valor_estimado: centavosParaReais(totalCentavos),
        tipo: dados.tipo,
        categoria_id: categoriaId,
        parcelamento_id: null,
        numero_parcela: null,
      })

      if (error) {
        return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível salvar a transação.') }
      }

      return {
        ok: true,
        mensagem: dados.tipo === 'receita' ? 'Receita adicionada.' : 'Despesa adicionada.',
      }
    }

    /*
     * Parcelamento
     *
     * A distribuição é feita em centavos inteiros (sem perda) e o
     * parcelamento + parcelas são criados em uma única transação no
     * banco (RPC criar_parcelamento).
     */
    if (dados.tipo !== 'despesa') {
      throw new ErroValidacao('Somente despesas podem ser parceladas.')
    }

    if (quantidade > totalCentavos) {
      throw new ErroValidacao('O valor total é pequeno demais para essa quantidade de parcelas.')
    }

    const valores = distribuirParcelas(totalCentavos, quantidade).map(centavosParaReais)

    const { data, error } = await supabase.rpc('criar_parcelamento', {
      p_nome: nome,
      p_tipo: dados.tipo,
      p_categoria_id: categoriaId,
      p_mes_inicio: mesReferencia,
      p_valores: valores,
    })

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível criar o parcelamento.') }
    }

    return {
      ok: true,
      mensagem: `Parcelamento criado em ${quantidade} parcelas.`,
      dados: { parcelamentoId: data as string },
    }
  }, 'Não foi possível salvar a transação.')
}

/*
 * =====================================================
 * ATUALIZAR TRANSAÇÃO
 * =====================================================
 *
 * - Transação simples: atualiza o próprio registro.
 * - Parcela: usa a RPC editar_parcela com escopo explícito:
 *     'unica'   → somente esta parcela
 *     'futuras' → esta e as próximas não pagas
 */

interface AtualizacaoTransacao {
  id: string
  nome: string
  valorCentavos: number
  mesReferencia: string
  categoriaId?: number
  escopo?: EscopoEdicao
}

export async function atualizarTransacao(
  dados: AtualizacaoTransacao
): Promise<Resultado<{ afetadas: number }>> {
  return executar(async () => {
    const { supabase, user } = await obterContexto()

    const nome = validarNome(dados.nome)
    const valorCentavos = validarCentavos(dados.valorCentavos)
    const mesReferencia = validarMes(dados.mesReferencia)

    const { data: transacao, error: buscaError } = await supabase
      .from('transacoes')
      .select('id, tipo, parcelamento_id')
      .eq('id', dados.id)
      .eq('usuario_id', user.id)
      .single()

    if (buscaError || !transacao) {
      return { ok: false, erro: 'Transação não encontrada.' }
    }

    const categoriaId = validarCategoria(transacao.tipo, dados.categoriaId)

    if (transacao.parcelamento_id) {
      const escopo: EscopoEdicao = dados.escopo ?? 'unica'

      const { data, error } = await supabase.rpc('editar_parcela', {
        p_transacao_id: dados.id,
        p_escopo: escopo,
        p_nome: nome,
        p_valor: centavosParaReais(valorCentavos),
        p_mes: mesReferencia,
        p_categoria_id: categoriaId,
      })

      if (error) {
        return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível atualizar a parcela.') }
      }

      const afetadas = Number(data ?? 0)

      return {
        ok: true,
        mensagem:
          escopo === 'unica'
            ? 'Parcela atualizada.'
            : `${afetadas} ${afetadas === 1 ? 'parcela atualizada' : 'parcelas atualizadas'}.`,
        dados: { afetadas },
      }
    }

    const { error } = await supabase
      .from('transacoes')
      .update({
        nome,
        valor_estimado: centavosParaReais(valorCentavos),
        mes_referencia: mesReferencia,
        categoria_id: categoriaId,
      })
      .eq('id', dados.id)
      .eq('usuario_id', user.id)

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível atualizar a transação.') }
    }

    return { ok: true, mensagem: 'Transação atualizada.', dados: { afetadas: 1 } }
  }, 'Não foi possível atualizar a transação.')
}

/*
 * =====================================================
 * BUSCAR TRANSAÇÕES DO MÊS
 * =====================================================
 */
export async function buscarTransacoes(mesReferencia: string): Promise<Transacao[]> {
  const { supabase, user } = await obterContexto()
  const mes = normalizarMes(mesReferencia)

  if (!mes) {
    throw new Error('Mês de referência inválido.')
  }

  const consulta = (campos: string) =>
    supabase
      .from('transacoes')
      .select(campos)
      .eq('usuario_id', user.id)
      .eq('mes_referencia', mes)
      .order('created_at', { ascending: false })

  const { data, error } = await consulta(SELECT_TRANSACAO)

  if (!error) {
    return (data ?? []) as unknown as Transacao[]
  }

  /*
   * Compatibilidade: se a migration ainda não foi aplicada, a consulta
   * com as colunas novas falha. Buscamos sem elas e tratamos como
   * "sem status" — o app continua funcionando como antes.
   */
  if (colunaInexistente(error)) {
    const legado = await consulta(SELECT_TRANSACAO_BASE)

    if (!legado.error) {
      return ((legado.data ?? []) as unknown as Transacao[]).map((t) => ({
        ...t,
        status_pagamento: null,
        pago_em: null,
      }))
    }
  }

  console.error('Erro ao buscar transações:', error)
  throw new Error('Não foi possível carregar suas transações.')
}

/*
 * =====================================================
 * BUSCAR PARCELAMENTOS
 * =====================================================
 */
export async function buscarParcelamentos(): Promise<ParcelamentoComParcelas[]> {
  const { supabase, user } = await obterContexto()

  const { data, error } = await supabase
    .from('parcelamentos')
    .select(`
      id,
      nome,
      total_parcelas,
      valor_total,
      valor_contratado,
      parcelas:transacoes!transacoes_parcelamento_usuario_fkey (
        id,
        nome,
        mes_referencia,
        valor_estimado,
        valor_real,
        tipo,
        categoria_id,
        numero_parcela,
        status_pagamento,
        pago_em
      )
    `)
    .eq('usuario_id', user.id)

  if (error) {
    console.error('Erro ao buscar parcelamentos:', error)

    throw new Error(
      colunaInexistente(error)
        ? 'O banco de dados está desatualizado. Aplique a migration da FASE 1 no Supabase.'
        : 'Não foi possível carregar seus parcelamentos.'
    )
  }

  return (data ?? []) as unknown as ParcelamentoComParcelas[]
}

/*
 * =====================================================
 * PAGAMENTO
 * =====================================================
 */
export async function definirPagamento(
  id: string,
  pago: boolean
): Promise<Resultado<{ pagoEm: string | null }>> {
  return executar(async () => {
    const { supabase, user } = await obterContexto()

    const pagoEm = pago ? new Date().toISOString() : null

    const { data, error } = await supabase
      .from('transacoes')
      .update({
        status_pagamento: pago ? 'pago' : 'pendente',
        pago_em: pagoEm,
      })
      .eq('id', id)
      .eq('usuario_id', user.id)
      .select('id')

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível atualizar o pagamento.') }
    }

    if (!data || data.length === 0) {
      return { ok: false, erro: 'Transação não encontrada.' }
    }

    return {
      ok: true,
      mensagem: pago ? 'Marcada como paga.' : 'Pagamento desfeito.',
      dados: { pagoEm },
    }
  }, 'Não foi possível atualizar o pagamento.')
}

/*
 * =====================================================
 * EXCLUSÃO
 * =====================================================
 */

/** Exclui uma transação simples (não parcelada). */
export async function excluirTransacao(id: string): Promise<Resultado> {
  return executar(async () => {
    const { supabase, user } = await obterContexto()

    const { data: transacao, error: buscaError } = await supabase
      .from('transacoes')
      .select('id, parcelamento_id')
      .eq('id', id)
      .eq('usuario_id', user.id)
      .single()

    if (buscaError || !transacao) {
      return { ok: false, erro: 'Transação não encontrada.' }
    }

    // Parcelas nunca são excluídas por aqui: use excluirParcela ou
    // excluirParcelamento, que deixam a intenção explícita.
    if (transacao.parcelamento_id) {
      return { ok: false, erro: 'Esta transação é uma parcela. Escolha como deseja excluí-la.' }
    }

    const { error } = await supabase
      .from('transacoes')
      .delete()
      .eq('id', id)
      .eq('usuario_id', user.id)

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível excluir a transação.') }
    }

    return { ok: true, mensagem: 'Transação excluída.' }
  }, 'Não foi possível excluir a transação.')
}

/** Exclui somente uma parcela (não paga). */
export async function excluirParcela(id: string): Promise<Resultado> {
  return executar(async () => {
    const { supabase } = await obterContexto()

    const { error } = await supabase.rpc('excluir_parcela', { p_transacao_id: id })

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível excluir a parcela.') }
    }

    return { ok: true, mensagem: 'Parcela excluída.' }
  }, 'Não foi possível excluir a parcela.')
}

/** Exclui o parcelamento inteiro e todas as suas parcelas. */
export async function excluirParcelamento(parcelamentoId: string): Promise<Resultado> {
  return executar(async () => {
    const { supabase } = await obterContexto()

    const { data, error } = await supabase.rpc('excluir_parcelamento', {
      p_parcelamento_id: parcelamentoId,
    })

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível excluir o parcelamento.') }
    }

    const excluidas = Number(data ?? 0)

    return {
      ok: true,
      mensagem: `Parcelamento excluído (${excluidas} ${excluidas === 1 ? 'parcela' : 'parcelas'}).`,
    }
  }, 'Não foi possível excluir o parcelamento.')
}
