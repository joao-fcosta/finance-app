'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { DataISO, dataNoMes, dataValida, hoje, partes } from '@/app/lib/datas'
import { normalizarMes } from '@/app/lib/meses'
import { Frequencia, horizonteGeracao } from '@/app/lib/recorrencias'
import { MAX_CENTAVOS, centavosParaReais, distribuirParcelas, formatarCentavos } from '@/app/lib/money'
import type {
  EscopoEdicao,
  ParcelamentoComParcelas,
  Recorrencia,
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

const SELECT_TRANSACAO = `${SELECT_TRANSACAO_BASE}, status_pagamento, pago_em, recorrencia_id, data_vencimento`

/** Coluna inexistente: a migration da FASE 1 ainda não foi aplicada. */
function colunaInexistente(error: ErroBanco) {
  return (
    error.code === '42703' ||
    error.code === '42P01' ||
    /status_pagamento|pago_em|valor_contratado|recorrencia|data_vencimento/.test(error.message)
  )
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
      .select('id, tipo, parcelamento_id, recorrencia_id, data_vencimento')
      .eq('id', dados.id)
      .eq('usuario_id', user.id)
      .single()

    if (buscaError || !transacao) {
      return { ok: false, erro: 'Transação não encontrada.' }
    }

    const categoriaId = validarCategoria(transacao.tipo, dados.categoriaId)

    // Ocorrência movida de mês: o vencimento acompanha (mesmo dia, ajustado
    // ao tamanho do mês). Edição individual não altera a recorrência.
    let dataVencimento: string | null = transacao.data_vencimento ?? null
    if (dataVencimento && dataVencimento.slice(0, 7) !== mesReferencia) {
      const [ano, mes] = mesReferencia.split('-').map(Number)
      dataVencimento = dataNoMes(ano, mes, partes(dataVencimento).dia)
    }

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
        ...(transacao.recorrencia_id ? { data_vencimento: dataVencimento } : {}),
      })
      .eq('id', dados.id)
      .eq('usuario_id', user.id)

    if (error) {
      if (error.code === '23505') {
        return { ok: false, erro: 'Já existe uma ocorrência desta recorrência nessa data.' }
      }
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

  await garantirOcorrencias(supabase, mes)

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
        recorrencia_id: null,
        data_vencimento: null,
      }))
    }
  }

  console.error('Erro ao buscar transações:', error)
  throw new Error('Não foi possível carregar suas transações.')
}

/*
 * Gera, no servidor, as ocorrências de recorrências que faltam até o
 * horizonte do mês consultado (idempotente: não duplica). Falhas aqui
 * não impedem a leitura dos dados já existentes.
 */
type ClienteSupabase = Awaited<ReturnType<typeof criarSupabase>>

async function garantirOcorrencias(supabase: ClienteSupabase, mes: string) {
  const { error } = await supabase.rpc('gerar_ocorrencias', {
    p_ate: horizonteGeracao(mes, hoje()),
  })

  if (error && !funcaoInexistente(error)) {
    console.error('Erro ao gerar ocorrências recorrentes:', error)
  }
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

/** Cancela só as parcelas pendentes de meses futuros. */
export async function cancelarParcelasFuturas(parcelamentoId: string): Promise<Resultado<{ canceladas: number }>> {
  return executar(async () => {
    const { supabase } = await obterContexto()

    const { data, error } = await supabase.rpc('cancelar_parcelas_futuras', {
      p_parcelamento_id: parcelamentoId,
    })

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível cancelar as parcelas futuras.') }
    }

    const canceladas = Number(data ?? 0)

    return {
      ok: true,
      mensagem: `${canceladas} ${canceladas === 1 ? 'parcela futura cancelada' : 'parcelas futuras canceladas'}.`,
      dados: { canceladas },
    }
  }, 'Não foi possível cancelar as parcelas futuras.')
}

/*
 * =====================================================
 * RECORRÊNCIAS (FASE 2)
 * =====================================================
 */

const FREQUENCIAS_VALIDAS: Frequencia[] = ['semanal', 'mensal', 'anual']

function validarData(data: string | null | undefined, mensagem: string): DataISO {
  if (!data || !dataValida(data)) {
    throw new ErroValidacao(mensagem)
  }

  return data
}

interface NovaRecorrencia {
  nome: string
  valorCentavos: number
  tipo: TipoTransacao
  categoriaId?: number
  frequencia: Frequencia
  intervalo: number
  dataInicio: string
  dataFim?: string | null
  /** Mês visualizado, para gerar as ocorrências até ele. */
  mesVisualizado?: string
}

export async function criarRecorrencia(
  dados: NovaRecorrencia
): Promise<Resultado<{ recorrenciaId: string }>> {
  return executar(async () => {
    const { supabase } = await obterContexto()

    if (dados.tipo !== 'receita' && dados.tipo !== 'despesa') {
      throw new ErroValidacao('Tipo de transação inválido.')
    }

    const nome = validarNome(dados.nome)
    const valorCentavos = validarCentavos(dados.valorCentavos)
    const categoriaId = validarCategoria(dados.tipo, dados.categoriaId)

    if (!FREQUENCIAS_VALIDAS.includes(dados.frequencia)) {
      throw new ErroValidacao('Escolha a frequência.')
    }

    if (!Number.isInteger(dados.intervalo) || dados.intervalo < 1 || dados.intervalo > 24) {
      throw new ErroValidacao('O intervalo deve ser entre 1 e 24.')
    }

    const dataInicio = validarData(dados.dataInicio, 'Informe a data da primeira ocorrência.')
    const dataFim = dados.dataFim ? validarData(dados.dataFim, 'Data final inválida.') : null

    if (dataFim && dataFim < dataInicio) {
      throw new ErroValidacao('A data final deve ser igual ou posterior à primeira ocorrência.')
    }

    const mes = normalizarMes(dados.mesVisualizado ?? '') ?? dataInicio.slice(0, 7)

    const { data, error } = await supabase.rpc('criar_recorrencia', {
      p_nome: nome,
      p_tipo: dados.tipo,
      p_categoria_id: categoriaId,
      p_valor: centavosParaReais(valorCentavos),
      p_frequencia: dados.frequencia,
      p_intervalo: dados.intervalo,
      p_data_inicio: dataInicio,
      p_data_fim: dataFim,
      p_gerar_ate: horizonteGeracao(mes > dataInicio.slice(0, 7) ? mes : dataInicio.slice(0, 7), hoje()),
    })

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível criar a recorrência.') }
    }

    return {
      ok: true,
      mensagem: dados.tipo === 'receita' ? 'Receita recorrente criada.' : 'Conta recorrente criada.',
      dados: { recorrenciaId: data as string },
    }
  }, 'Não foi possível criar a recorrência.')
}

export async function buscarRecorrencias(): Promise<Recorrencia[]> {
  const { supabase, user } = await obterContexto()

  const { data, error } = await supabase
    .from('recorrencias')
    .select('id, nome, tipo, categoria_id, valor, frequencia, intervalo, data_inicio, data_fim, status, created_at')
    .eq('usuario_id', user.id)
    .order('nome', { ascending: true })

  if (error) {
    console.error('Erro ao buscar recorrências:', error)
    throw new Error(
      colunaInexistente(error)
        ? 'O banco de dados está desatualizado. Aplique a migration da FASE 2 no Supabase.'
        : 'Não foi possível carregar suas recorrências.'
    )
  }

  return (data ?? []) as unknown as Recorrencia[]
}

interface EdicaoRecorrencia {
  id: string
  nome: string
  valorCentavos: number
  categoriaId?: number
  dataFim?: string | null
}

export async function editarRecorrencia(dados: EdicaoRecorrencia): Promise<Resultado<{ afetadas: number }>> {
  return executar(async () => {
    const { supabase } = await obterContexto()

    const nome = validarNome(dados.nome)
    const valorCentavos = validarCentavos(dados.valorCentavos)
    const dataFim = dados.dataFim ? validarData(dados.dataFim, 'Data final inválida.') : null

    if (dados.categoriaId !== undefined && ![1, 2, 3].includes(dados.categoriaId)) {
      throw new ErroValidacao('Selecione uma categoria.')
    }

    const { data, error } = await supabase.rpc('editar_recorrencia', {
      p_recorrencia_id: dados.id,
      p_nome: nome,
      p_valor: centavosParaReais(valorCentavos),
      p_categoria_id: dados.categoriaId ?? null,
      p_data_fim: dataFim,
    })

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, 'Não foi possível atualizar a recorrência.') }
    }

    const afetadas = Number(data ?? 0)

    return {
      ok: true,
      mensagem:
        afetadas > 0
          ? `Recorrência atualizada (${afetadas} ${afetadas === 1 ? 'ocorrência futura' : 'ocorrências futuras'}).`
          : 'Recorrência atualizada.',
      dados: { afetadas },
    }
  }, 'Não foi possível atualizar a recorrência.')
}

type AcaoRecorrencia = 'pausar' | 'reativar' | 'encerrar' | 'excluir'

const MENSAGENS_ACAO: Record<AcaoRecorrencia, { ok: string; erro: string }> = {
  pausar: { ok: 'Recorrência pausada.', erro: 'Não foi possível pausar a recorrência.' },
  reativar: { ok: 'Recorrência reativada.', erro: 'Não foi possível reativar a recorrência.' },
  encerrar: { ok: 'Recorrência encerrada. O histórico foi mantido.', erro: 'Não foi possível encerrar a recorrência.' },
  excluir: { ok: 'Recorrência excluída. O histórico foi mantido.', erro: 'Não foi possível excluir a recorrência.' },
}

export async function alterarStatusRecorrencia(id: string, acao: AcaoRecorrencia): Promise<Resultado> {
  const mensagens = MENSAGENS_ACAO[acao]

  return executar(async () => {
    const { supabase } = await obterContexto()

    if (!mensagens) {
      throw new ErroValidacao('Ação inválida.')
    }

    const chamada =
      acao === 'reativar'
        ? supabase.rpc('reativar_recorrencia', {
            p_recorrencia_id: id,
            p_gerar_ate: horizonteGeracao(hoje().slice(0, 7), hoje()),
          })
        : supabase.rpc(`${acao}_recorrencia`, { p_recorrencia_id: id })

    const { error } = await chamada

    if (error) {
      return { ok: false, erro: mensagemDoBanco(error, mensagens.erro) }
    }

    return { ok: true, mensagem: mensagens.ok }
  }, mensagens?.erro ?? 'Não foi possível concluir a operação.')
}
