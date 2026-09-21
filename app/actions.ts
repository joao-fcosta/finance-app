'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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

interface NovaTransacao {
  nome: string
  valor: number
  mesReferencia: string
  tipo: 'receita' | 'despesa'
  categoriaId?: number
  parcelas?: number
}


/*
 * ADICIONAR TRANSAÇÃO
 */
export async function adicionarTransacao(
  dados: NovaTransacao
) {
  const supabase = await criarSupabase()

  /*
   * Verifica o usuário logado
   */
  const {
    data: { user },
    error: usuarioError,
  } = await supabase.auth.getUser()

  if (usuarioError || !user) {
    throw new Error('Usuário não autenticado.')
  }

  /*
   * Validações
   */
  if (!dados.nome.trim()) {
    throw new Error('Informe o nome da transação.')
  }

  if (!dados.valor || dados.valor <= 0) {
    throw new Error('O valor deve ser maior que zero.')
  }

  /*
   * Remove espaços do mês.
   *
   * Exemplo:
   * "2026 -09 " → "2026-09"
   */
  const mesReferencia = dados.mesReferencia
    .trim()
    .replace(/\s/g, '')

  /*
   * Confere se o mês está no formato YYYY-MM.
   */
  if (!/^\d{4}-\d{2}$/.test(mesReferencia)) {
    throw new Error(
      'Mês de referência inválido.'
    )
  }

  const quantidadeParcelas = dados.parcelas ?? 1

  if (
    !Number.isInteger(quantidadeParcelas) ||
    quantidadeParcelas < 1
  ) {
    throw new Error(
      'Quantidade de parcelas inválida.'
    )
  }


  /*
   * =====================================================
   * TRANSAÇÃO NORMAL
   * =====================================================
   */
  if (quantidadeParcelas === 1) {
    const { error } = await supabase
      .from('transacoes')
      .insert({
        usuario_id: user.id,
        nome: dados.nome.trim(),
        mes_referencia: mesReferencia,
        valor_estimado: dados.valor,
        tipo: dados.tipo,

        categoria_id:
          dados.tipo === 'despesa'
            ? dados.categoriaId ?? null
            : null,

        parcelamento_id: null,
        numero_parcela: null,
      })

    if (error) {
      console.error(
        'Erro ao adicionar transação:',
        error
      )

      throw new Error(
        `Erro do Supabase: ${error.message}`
      )
    }

    return {
      sucesso: true,
      mensagem:
        'Transação adicionada com sucesso.',
    }
  }


  /*
   * =====================================================
   * PARCELAMENTO
   * =====================================================
   *
   * Exemplo:
   *
   * valor = 1200
   * parcelas = 3
   *
   * parcela = 1200 / 3 = 400
   *
   * Resultado:
   *
   * 1/3 → 2026-09 → 400
   * 2/3 → 2026-10 → 400
   * 3/3 → 2026-11 → 400
   */

  const valorPorParcela =
    dados.valor / quantidadeParcelas

  /*
   * Arredonda para evitar problemas de casas decimais.
   *
   * Exemplo:
   * 100 / 3 = 33.333333...
   *
   * Vai para:
   * 33.33
   */
  const valorParcela = Number(
    valorPorParcela.toFixed(2)
  )


  /*
   * Cria o registro principal do parcelamento.
   */
  const { data: parcelamento, error: parcelamentoError } =
    await supabase
      .from('parcelamentos')
      .insert({
        usuario_id: user.id,
        nome: dados.nome.trim(),
        total_parcelas: quantidadeParcelas,
        valor_total: dados.valor,
      })
      .select('id')
      .single()

  if (parcelamentoError || !parcelamento) {
    console.error(
      'Erro ao criar parcelamento:',
      parcelamentoError
    )

    throw new Error(
      `Erro ao criar parcelamento: ${parcelamentoError?.message ??
      'registro não criado'
      }`
    )
  }


  /*
   * Monta todas as parcelas.
   */
  const transacoes = []

  for (let i = 0; i < quantidadeParcelas; i++) {
    /*
     * Começa no primeiro dia do mês escolhido.
     *
     * O horário 12:00 evita problemas de mudança
     * de horário/DST.
     */
    const dataParcela = new Date(
      `${mesReferencia}-01T12:00:00`
    )

    /*
     * Avança um mês para cada parcela.
     */
    dataParcela.setMonth(
      dataParcela.getMonth() + i
    )

    /*
     * Converte novamente para YYYY-MM.
     */
    const mesParcela = `${dataParcela.getFullYear()}-${String(
      dataParcela.getMonth() + 1
    ).padStart(2, '0')}`

    transacoes.push({
      usuario_id: user.id,

      nome: `${dados.nome.trim()} (${i + 1}/${quantidadeParcelas})`,

      mes_referencia: mesParcela,

      valor_estimado: valorParcela,

      tipo: dados.tipo,

      categoria_id:
        dados.tipo === 'despesa'
          ? dados.categoriaId ?? null
          : null,

      parcelamento_id: parcelamento.id,

      numero_parcela: i + 1,
    })
  }


  /*
   * Insere todas as parcelas de uma vez.
   */
  const { error: transacoesError } =
    await supabase
      .from('transacoes')
      .insert(transacoes)

  /*
   * Se falhar ao criar as transações,
   * remove o parcelamento que acabamos de criar.
   */
  if (transacoesError) {
    console.error(
      'Erro ao criar parcelas:',
      transacoesError
    )

    await supabase
      .from('parcelamentos')
      .delete()
      .eq('id', parcelamento.id)

    throw new Error(
      `Erro ao criar parcelas: ${transacoesError.message}`
    )
  }


  return {
    sucesso: true,

    mensagem:
      `${quantidadeParcelas} parcelas criadas com sucesso.`,

    parcelamentoId: parcelamento.id,
  }
}

/*
 * =====================================================
 * ATUALIZAR TRANSAÇÃO
 * =====================================================
 */
export async function atualizarTransacao(
  dados: {
    id: string
    nome: string
    valor: number
    mesReferencia: string
    categoriaId?: number
  }
) {
  const supabase = await criarSupabase()

  /*
   * Verifica o usuário logado
   */
  const {
    data: { user },
    error: usuarioError,
  } = await supabase.auth.getUser()

  if (usuarioError || !user) {
    throw new Error('Usuário não autenticado.')
  }

  /*
   * Validações
   */
  if (!dados.nome.trim()) {
    throw new Error(
      'Informe o nome da transação.'
    )
  }

  if (!dados.valor || dados.valor <= 0) {
    throw new Error(
      'O valor deve ser maior que zero.'
    )
  }

  const mesReferencia = dados.mesReferencia
    .trim()
    .replace(/\s/g, '')

  if (!/^\d{4}-\d{2}$/.test(mesReferencia)) {
    throw new Error(
      'Mês de referência inválido.'
    )
  }

  /*
   * Primeiro buscamos a transação para descobrir
   * se ela pertence a um parcelamento.
   */
  const { data: transacao, error: buscaError } =
    await supabase
      .from('transacoes')
      .select(`
        id,
        tipo,
        parcelamento_id
      `)
      .eq('id', dados.id)
      .eq('usuario_id', user.id)
      .single()

  if (buscaError || !transacao) {
    throw new Error(
      'Transação não encontrada.'
    )
  }

  /*
   * Por enquanto a edição será permitida apenas
   * para transações normais.
   *
   * Parcelamentos serão tratados na próxima etapa.
   */
  if (transacao.parcelamento_id) {
    throw new Error(
      'Edição de parcelamentos será tratada separadamente.'
    )
  }

  /*
   * Atualiza a transação.
   */
  const { error } = await supabase
    .from('transacoes')
    .update({
      nome: dados.nome.trim(),
      valor_estimado: dados.valor,
      mes_referencia: mesReferencia,

      categoria_id:
        transacao.tipo === 'despesa'
          ? dados.categoriaId ?? null
          : null,
    })
    .eq('id', dados.id)
    .eq('usuario_id', user.id)

  if (error) {
    console.error(
      'Erro ao atualizar transação:',
      error
    )

    throw new Error(
      `Erro ao atualizar transação: ${error.message}`
    )
  }

  return {
    sucesso: true,
    mensagem:
      'Transação atualizada com sucesso.',
  }
}
/*
 * =====================================================
 * BUSCAR TRANSAÇÕES
 * =====================================================
 */
export async function buscarTransacoes(
  mesReferencia: string
) {
  const supabase = await criarSupabase()

  const {
    data: { user },
    error: usuarioError,
  } = await supabase.auth.getUser()

  if (usuarioError || !user) {
    throw new Error('Usuário não autenticado.')
  }

  const mes = mesReferencia
    .trim()
    .replace(/\s/g, '')

  const { data, error } = await supabase
    .from('transacoes')
    .select(`
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
    `)
    .eq('usuario_id', user.id)
    .eq('mes_referencia', mes)
    .order('created_at', {
      ascending: false,
    })

  if (error) {
    console.error(
      'Erro ao buscar transações:',
      error
    )

    throw new Error(
      `Erro ao buscar transações: ${error.message}`
    )
  }

  return data ?? []
}


/*
 * =====================================================
 * EXCLUIR TRANSAÇÃO
 * =====================================================
 */
export async function excluirTransacao(
  id: string
) {
  const supabase = await criarSupabase()

  const {
    data: { user },
    error: usuarioError,
  } = await supabase.auth.getUser()

  if (usuarioError || !user) {
    throw new Error('Usuário não autenticado.')
  }

  /*
   * Busca a transação primeiro para descobrir
   * se ela pertence a um parcelamento.
   */
  const { data: transacao, error: buscaError } =
    await supabase
      .from('transacoes')
      .select('id, parcelamento_id')
      .eq('id', id)
      .eq('usuario_id', user.id)
      .single()

  if (buscaError || !transacao) {
    throw new Error(
      'Transação não encontrada.'
    )
  }


  /*
   * Se pertence a um parcelamento,
   * excluímos o parcelamento inteiro.
   *
   * Como existe:
   *
   * ON DELETE CASCADE
   *
   * todas as parcelas serão excluídas
   * automaticamente.
   */
  if (transacao.parcelamento_id) {
    const { error } = await supabase
      .from('parcelamentos')
      .delete()
      .eq(
        'id',
        transacao.parcelamento_id
      )
      .eq('usuario_id', user.id)

    if (error) {
      console.error(
        'Erro ao excluir parcelamento:',
        error
      )

      throw new Error(
        `Erro ao excluir parcelamento: ${error.message}`
      )
    }

    return {
      sucesso: true,
      mensagem:
        'Parcelamento excluído com sucesso.',
    }
  }


  /*
   * Transação normal.
   */
  const { error } = await supabase
    .from('transacoes')
    .delete()
    .eq('id', id)
    .eq('usuario_id', user.id)

  if (error) {
    console.error(
      'Erro ao excluir transação:',
      error
    )

    throw new Error(
      `Erro ao excluir transação: ${error.message}`
    )
  }

  return {
    sucesso: true,
    mensagem:
      'Transação excluída com sucesso.',
  }
}