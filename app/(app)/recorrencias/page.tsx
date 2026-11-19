'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { alterarStatusRecorrencia, buscarRecorrencias, type Resultado } from '@/app/actions'
import { useApp } from '@/app/components/AppShell'
import ConfirmDialog, { type AcaoDialogo } from '@/app/components/ConfirmDialog'
import Icon from '@/app/components/Icon'
import RecorrenciaModal from '@/app/components/RecorrenciaModal'
import { descreverPrazo, formatarData, formatarDataCurta, hoje } from '@/app/lib/datas'
import { formatarCentavos, reaisParaCentavos } from '@/app/lib/money'
import { descreverFrequencia, proximaOcorrencia, valorMensalEquivalenteCentavos } from '@/app/lib/recorrencias'
import { nomeCategoria, type Recorrencia } from '@/app/lib/types'

type Aba = 'ativa' | 'pausada' | 'encerrada'
type Acao = 'pausar' | 'reativar' | 'encerrar' | 'excluir'

const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: 'ativa', rotulo: 'Ativas' },
  { valor: 'pausada', rotulo: 'Pausadas' },
  { valor: 'encerrada', rotulo: 'Encerradas' },
]

const CONFIRMACOES: Record<Exclude<Acao, 'reativar'>, { titulo: string; texto: string; botao: string }> = {
  pausar: {
    titulo: 'Pausar recorrência?',
    texto: 'As próximas ocorrências pendentes serão removidas e nada novo será gerado até você reativar. O período pausado não é cobrado depois.',
    botao: 'Pausar',
  },
  encerrar: {
    titulo: 'Encerrar recorrência?',
    texto: 'As próximas ocorrências pendentes serão removidas e a recorrência termina hoje. O histórico (passadas e pagas) é mantido.',
    botao: 'Encerrar',
  },
  excluir: {
    titulo: 'Excluir recorrência?',
    texto: 'A regra será apagada e as próximas ocorrências pendentes removidas. As ocorrências passadas e pagas continuam no histórico como transações comuns.',
    botao: 'Excluir',
  },
}

function CartaoRecorrencia({ recorrencia, dataHoje, onAbrir }: { recorrencia: Recorrencia; dataHoje: string; onAbrir: () => void }) {
  const receita = recorrencia.tipo === 'receita'
  const proxima = proximaOcorrencia(recorrencia, dataHoje)
  const categoria = nomeCategoria(recorrencia.categoria_id)

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex w-full items-center gap-3 rounded-3xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-[0.995] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
          receita ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400'
        }`}
      >
        <Icon name="repeat" size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{recorrencia.nome}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
          {descreverFrequencia(recorrencia)}
          {categoria ? ` · ${categoria}` : ''}
        </span>
        <span className="mt-1 block truncate text-xs font-medium text-slate-600 dark:text-slate-300">
          {recorrencia.status === 'ativa'
            ? proxima
              ? `Próxima: ${formatarDataCurta(proxima)} (${descreverPrazo(proxima, dataHoje)})`
              : 'Sem próximas ocorrências'
            : recorrencia.status === 'pausada'
              ? 'Pausada'
              : `Encerrada${recorrencia.data_fim ? ` em ${formatarData(recorrencia.data_fim)}` : ''}`}
          {recorrencia.status === 'ativa' && recorrencia.data_fim ? ` · até ${formatarData(recorrencia.data_fim)}` : ''}
        </span>
      </span>
      <span className={`shrink-0 text-sm font-bold tabular-nums ${receita ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
        {receita ? '+' : '−'}
        {formatarCentavos(reaisParaCentavos(Number(recorrencia.valor)))}
      </span>
    </button>
  )
}

export default function PaginaRecorrencias() {
  const { mostrar, abrirLancamento, notificarAlteracao, versaoDados } = useApp()
  const [recorrencias, setRecorrencias] = useState<Recorrencia[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [aba, setAba] = useState<Aba>('ativa')
  const [menu, setMenu] = useState<Recorrencia | null>(null)
  const [confirmacao, setConfirmacao] = useState<{ acao: Exclude<Acao, 'reativar'>; recorrencia: Recorrencia } | null>(null)
  const [editando, setEditando] = useState<Recorrencia | null>(null)
  const [processando, setProcessando] = useState(false)

  const dataHoje = hoje()
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])

  useEffect(() => {
    let cancelado = false
    buscarRecorrencias()
      .then((dados) => {
        if (cancelado) return
        setRecorrencias(dados)
        setErro(null)
      })
      .catch((e) => {
        if (cancelado) return
        console.error(e)
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar suas recorrências.')
      })
      .finally(() => !cancelado && setLoading(false))
    return () => {
      cancelado = true
    }
  }, [versao, versaoDados])

  const porStatus = useMemo(() => {
    const grupos: Record<Aba, Recorrencia[]> = { ativa: [], pausada: [], encerrada: [] }
    for (const r of recorrencias) grupos[r.status].push(r)
    return grupos
  }, [recorrencias])

  const totalMensal = (tipo: 'receita' | 'despesa') =>
    porStatus.ativa
      .filter((r) => r.tipo === tipo)
      .reduce((total, r) => total + valorMensalEquivalenteCentavos(r, reaisParaCentavos(Number(r.valor))), 0)

  const executar = async (operacao: () => Promise<Resultado>) => {
    setProcessando(true)
    try {
      const resultado = await operacao()
      if (resultado.ok) {
        mostrar(resultado.mensagem)
        setMenu(null)
        setConfirmacao(null)
        notificarAlteracao()
      } else {
        mostrar(resultado.erro, 'erro')
      }
    } catch (e) {
      console.error(e)
      mostrar('Não foi possível concluir a operação. Tente novamente.', 'erro')
    } finally {
      setProcessando(false)
    }
  }

  const acoesMenu = (r: Recorrencia): AcaoDialogo[] => {
    const acoes: AcaoDialogo[] = []
    if (r.status !== 'encerrada') {
      acoes.push({ label: 'Editar', detalhe: 'Nome, valor, categoria ou data final', variante: 'neutra', onClick: () => { setMenu(null); setEditando(r) } })
    }
    if (r.status === 'ativa') {
      acoes.push({ label: 'Pausar', detalhe: 'Para de gerar até você reativar', variante: 'neutra', onClick: () => { setMenu(null); setConfirmacao({ acao: 'pausar', recorrencia: r }) } })
    }
    if (r.status === 'pausada') {
      acoes.push({ label: 'Reativar', detalhe: 'Volta a gerar a partir de hoje', variante: 'primaria', onClick: () => void executar(() => alterarStatusRecorrencia(r.id, 'reativar')) })
    }
    if (r.status !== 'encerrada') {
      acoes.push({ label: 'Encerrar', detalhe: 'Termina hoje e mantém o histórico', variante: 'neutra', onClick: () => { setMenu(null); setConfirmacao({ acao: 'encerrar', recorrencia: r }) } })
    }
    acoes.push({ label: 'Excluir', detalhe: 'Remove a regra; o histórico fica', variante: 'perigo', onClick: () => { setMenu(null); setConfirmacao({ acao: 'excluir', recorrencia: r }) } })
    return acoes
  }

  const lista = porStatus[aba]

  return (
    <main>
      <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-5 sm:px-5">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">Recorrentes</h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Cadastre uma vez. O app gera todo período.</p>
          </div>
          <button
            type="button"
            onClick={() => abrirLancamento({ tipo: 'despesa', modo: 'recorrente' })}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-violet-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-violet-700 active:scale-95"
          >
            <Icon name="plus" size={16} />
            Nova
          </button>
        </header>

        <section className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Contas fixas / mês</p>
            <p className="mt-1 break-words text-lg font-bold text-rose-600 dark:text-rose-400">{formatarCentavos(totalMensal('despesa'))}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Receitas fixas / mês</p>
            <p className="mt-1 break-words text-lg font-bold text-emerald-700 dark:text-emerald-400">{formatarCentavos(totalMensal('receita'))}</p>
          </div>
        </section>

        <div role="tablist" aria-label="Situação das recorrências" className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-slate-200/60 p-1 dark:bg-slate-800">
          {ABAS.map((a) => (
            <button
              key={a.valor}
              type="button"
              role="tab"
              id={`aba-rec-${a.valor}`}
              aria-selected={aba === a.valor}
              aria-controls="painel-recorrencias"
              onClick={() => setAba(a.valor)}
              className={`min-h-10 rounded-xl text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                aba === a.valor ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {a.rotulo} ({porStatus[a.valor].length})
            </button>
          ))}
        </div>

        <div id="painel-recorrencias" role="tabpanel" aria-labelledby={`aba-rec-${aba}`} className="space-y-3">
          {loading ? (
            <p role="status" className="py-10 text-center text-sm text-slate-500">Carregando recorrências...</p>
          ) : erro ? (
            <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-6 text-center dark:border-rose-900 dark:bg-rose-950/30">
              <p className="text-sm text-rose-700 dark:text-rose-300">{erro}</p>
              <button type="button" onClick={() => { setLoading(true); recarregar() }} className="mt-2 text-sm font-bold text-emerald-700 underline dark:text-emerald-400">
                Tentar novamente
              </button>
            </div>
          ) : lista.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 px-5 py-10 text-center dark:border-slate-700">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {aba === 'ativa' ? 'Nenhuma recorrência ativa' : aba === 'pausada' ? 'Nenhuma recorrência pausada' : 'Nenhuma recorrência encerrada'}
              </p>
              {aba === 'ativa' && (
                <>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Aluguel, internet, assinaturas, salário: cadastre uma vez.</p>
                  <button
                    type="button"
                    onClick={() => abrirLancamento({ tipo: 'despesa', modo: 'recorrente' })}
                    className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-full bg-violet-600 px-4 text-xs font-bold text-white hover:bg-violet-700"
                  >
                    <Icon name="plus" size={16} />
                    Criar recorrência
                  </button>
                </>
              )}
            </div>
          ) : (
            lista.map((r) => <CartaoRecorrencia key={r.id} recorrencia={r} dataHoje={dataHoje} onAbrir={() => setMenu(r)} />)
          )}
        </div>
      </div>

      <ConfirmDialog
        aberto={!!menu}
        titulo={menu?.nome ?? ''}
        descricao={menu ? descreverFrequencia(menu) : undefined}
        acoes={menu ? acoesMenu(menu) : []}
        onFechar={() => !processando && setMenu(null)}
        carregando={processando}
        rotuloCancelar="Fechar"
      />

      <ConfirmDialog
        aberto={!!confirmacao}
        titulo={confirmacao ? CONFIRMACOES[confirmacao.acao].titulo : ''}
        descricao={
          confirmacao && (
            <>
              <strong>{confirmacao.recorrencia.nome}</strong>: {CONFIRMACOES[confirmacao.acao].texto}
            </>
          )
        }
        acoes={
          confirmacao
            ? [{
                label: CONFIRMACOES[confirmacao.acao].botao,
                variante: confirmacao.acao === 'pausar' ? 'primaria' : 'perigo',
                onClick: () => void executar(() => alterarStatusRecorrencia(confirmacao.recorrencia.id, confirmacao.acao)),
              }]
            : []
        }
        onFechar={() => !processando && setConfirmacao(null)}
        carregando={processando}
      />

      {editando && (
        <RecorrenciaModal
          recorrencia={editando}
          onClose={() => setEditando(null)}
          onSalvo={(mensagem) => {
            setEditando(null)
            mostrar(mensagem)
            notificarAlteracao()
          }}
        />
      )}
    </main>
  )
}
