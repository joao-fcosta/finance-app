'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  buscarCartoes,
  buscarFatura,
  desfazerPagamentoFatura,
  editarCartao,
  excluirCartao,
  type Resultado,
} from '@/app/actions'
import { useApp } from '@/app/components/AppShell'
import CartaoModal from '@/app/components/CartaoModal'
import ConfirmDialog, { type AcaoDialogo } from '@/app/components/ConfirmDialog'
import Icon from '@/app/components/Icon'
import PagamentoFaturaModal from '@/app/components/PagamentoFaturaModal'
import { useOperacoesTransacao } from '@/app/components/useOperacoesTransacao'
import {
  ROTULO_STATUS_FATURA,
  StatusFatura,
  cicloDaCompra,
  limiteCartao,
  restanteFaturaCentavos,
  statusFatura,
} from '@/app/lib/cartoes'
import { formatarData, formatarDataCurta, hoje } from '@/app/lib/datas'
import { formatarMesCurto } from '@/app/lib/meses'
import { formatarCentavos, reaisParaCentavos } from '@/app/lib/money'
import { nomeCategoria, type CartaoComResumo, type FaturaDetalhada, type FaturaResumo } from '@/app/lib/types'

const COR_STATUS: Record<StatusFatura, string> = {
  aberta: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  fechada: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
  parcial: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
  paga: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
  vencida: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400',
  vazia: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

function BadgeFatura({ status }: { status: StatusFatura }) {
  return <span className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${COR_STATUS[status]}`}>{ROTULO_STATUS_FATURA[status]}</span>
}

function BarraLimite({ percentual, acima }: { percentual: number; acima: boolean }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label="Limite utilizado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentual}>
      <div className={`h-full rounded-full transition-all ${acima ? 'bg-rose-500' : percentual >= 80 ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${percentual}%` }} />
    </div>
  )
}

/** Resumo calculado de um cartão. */
function resumir(cartao: CartaoComResumo, dataHoje: string) {
  const limite = limiteCartao(reaisParaCentavos(Number(cartao.limite)), cartao.comprasCentavos, cartao.pagamentosCentavos)
  const ciclo = cicloDaCompra(cartao, dataHoje)
  const atual = cartao.faturas.find((f) => f.mes_referencia === ciclo.mes_referencia) ?? null
  const proximas = cartao.faturas.filter((f) => f.mes_referencia > ciclo.mes_referencia && f.quantidadeCompras > 0)
  const anteriores = cartao.faturas.filter((f) => f.mes_referencia < ciclo.mes_referencia && (f.quantidadeCompras > 0 || f.pagoCentavos > 0)).reverse()
  const comprometidoFuturo = proximas.reduce((t, f) => t + restanteFaturaCentavos(f), 0)
  const emAberto = anteriores.filter((f) => restanteFaturaCentavos(f) > 0)
  return { limite, ciclo, atual, proximas, anteriores, comprometidoFuturo, emAberto }
}

function LinhaFatura({ fatura, dataHoje, onAbrir }: { fatura: FaturaResumo; dataHoje: string; onAbrir: () => void }) {
  const status = statusFatura(fatura, dataHoje)
  const restante = restanteFaturaCentavos(fatura)
  return (
    <li>
      <button type="button" onClick={onAbrir} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 dark:hover:bg-slate-800/50">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold capitalize">
            {formatarMesCurto(fatura.mes_referencia)}
            <BadgeFatura status={status} />
          </span>
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
            Vence {formatarData(fatura.data_vencimento)} · {fatura.quantidadeCompras} {fatura.quantidadeCompras === 1 ? 'compra' : 'compras'}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-bold tabular-nums">{formatarCentavos(fatura.totalCentavos)}</span>
          {fatura.pagoCentavos > 0 && restante > 0 && (
            <span className="block text-[11px] text-amber-600 dark:text-amber-400">falta {formatarCentavos(restante)}</span>
          )}
        </span>
        <Icon name="chevron-right" size={16} />
      </button>
    </li>
  )
}

function ConteudoCartoes() {
  const router = useRouter()
  const params = useSearchParams()
  const cartaoId = params.get('id')
  const faturaId = params.get('fatura')

  const { mostrar, notificarAlteracao, versaoDados, abrirLancamento } = useApp()
  const [cartoes, setCartoes] = useState<CartaoComResumo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [abaFaturas, setAbaFaturas] = useState<'proximas' | 'anteriores'>('proximas')
  const [editando, setEditando] = useState<CartaoComResumo | null | 'novo'>(null)
  const [menuCartao, setMenuCartao] = useState<CartaoComResumo | null>(null)
  const [confirmacao, setConfirmacao] = useState<{ titulo: string; texto: string; botao: string; acao: () => Promise<Resultado>; aoConcluir?: () => void } | null>(null)
  const [processando, setProcessando] = useState(false)
  const [fatura, setFatura] = useState<FaturaDetalhada | null>(null)
  const [carregandoFatura, setCarregandoFatura] = useState(false)
  const [pagando, setPagando] = useState(false)

  const dataHoje = hoje()
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  const operacoes = useOperacoesTransacao({ onConcluido: notificarAlteracao, mostrarMensagem: mostrar })

  useEffect(() => {
    let cancelado = false
    buscarCartoes()
      .then((dados) => {
        if (cancelado) return
        setCartoes(dados)
        setErro(null)
      })
      .catch((e) => {
        if (cancelado) return
        console.error(e)
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar seus cartões.')
      })
      .finally(() => !cancelado && setLoading(false))
    return () => {
      cancelado = true
    }
  }, [versao, versaoDados])

  useEffect(() => {
    if (!faturaId) return
    let cancelado = false
    // Carregamento assíncrono da fatura selecionada na URL.
    Promise.resolve()
      .then(() => !cancelado && setCarregandoFatura(true))
      .then(() => buscarFatura(faturaId))
      .then((dados) => !cancelado && setFatura(dados))
      .catch((e) => {
        console.error(e)
        if (!cancelado) mostrar('Não foi possível carregar a fatura.', 'erro')
      })
      .finally(() => !cancelado && setCarregandoFatura(false))
    return () => {
      cancelado = true
    }
  }, [faturaId, versaoDados, mostrar])

  const ativos = cartoes.filter((c) => c.ativo)
  const inativos = cartoes.filter((c) => !c.ativo)
  const selecionado = cartaoId ? cartoes.find((c) => c.id === cartaoId) ?? null : null
  const resumo = useMemo(() => (selecionado ? resumir(selecionado, dataHoje) : null), [selecionado, dataHoje])
  const cartaoDaFatura = fatura ? cartoes.find((c) => c.id === fatura.cartao_id) ?? null : null

  const ir = (consulta: string) => router.push(`/cartoes${consulta}`, { scroll: true })

  const executar = async (acao: () => Promise<Resultado>, aoConcluir?: () => void) => {
    setProcessando(true)
    try {
      const r = await acao()
      if (r.ok) {
        mostrar(r.mensagem)
        setConfirmacao(null)
        setMenuCartao(null)
        notificarAlteracao()
        aoConcluir?.()
      } else {
        mostrar(r.erro, 'erro')
      }
    } catch (e) {
      console.error(e)
      mostrar('Não foi possível concluir a operação.', 'erro')
    } finally {
      setProcessando(false)
    }
  }

  const acoesCartao = (c: CartaoComResumo): AcaoDialogo[] => {
    const dados = {
      nome: c.nome,
      bandeira: c.bandeira,
      limiteCentavos: reaisParaCentavos(Number(c.limite)),
      diaFechamento: c.dia_fechamento,
      diaVencimento: c.dia_vencimento,
    }
    return [
      { label: 'Editar', detalhe: 'Nome, limite, fechamento e vencimento', variante: 'neutra', onClick: () => { setMenuCartao(null); setEditando(c) } },
      c.ativo
        ? { label: 'Desativar', detalhe: 'Some dos lançamentos; o histórico fica', variante: 'neutra', onClick: () => void executar(() => editarCartao(c.id, { ...dados, ativo: false })) }
        : { label: 'Reativar', detalhe: 'Volta a aparecer nos lançamentos', variante: 'primaria', onClick: () => void executar(() => editarCartao(c.id, { ...dados, ativo: true })) },
      {
        label: 'Excluir',
        detalhe: c.comprasCentavos > 0 ? 'Indisponível: tem compras. Desative em vez disso.' : 'Remove o cartão',
        variante: 'perigo',
        desabilitada: c.comprasCentavos > 0,
        onClick: () => {
          setMenuCartao(null)
          setConfirmacao({ titulo: 'Excluir cartão?', texto: `${c.nome} será removido.`, botao: 'Excluir', acao: () => excluirCartao(c.id), aoConcluir: () => ir('') })
        },
      },
    ]
  }

  /* ------------------------- Lista de cartões ------------------------- */
  const renderCartao = (c: CartaoComResumo) => {
    const r = resumir(c, dataHoje)
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => ir(`?id=${encodeURIComponent(c.id)}`)}
        className={`w-full rounded-3xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-[0.995] dark:border-slate-800 dark:bg-slate-900 ${c.ativo ? '' : 'opacity-60'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400">
              <Icon name="credit-card" size={20} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-bold">{c.nome}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {c.bandeira ? `${c.bandeira} · ` : ''}fecha dia {c.dia_fechamento} · vence dia {c.dia_vencimento}
              </span>
            </span>
          </div>
          <span className="shrink-0 text-right">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">Fatura atual</span>
            <span className="block text-sm font-bold tabular-nums">{formatarCentavos(r.atual?.totalCentavos ?? 0)}</span>
          </span>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Disponível <strong className={`tabular-nums ${r.limite.acimaDoLimite ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>{formatarCentavos(r.limite.disponivelCentavos)}</strong></span>
            <span className="text-slate-500 dark:text-slate-400">de {formatarCentavos(reaisParaCentavos(Number(c.limite)))}</span>
          </div>
          <BarraLimite percentual={r.limite.percentualUtilizado} acima={r.limite.acimaDoLimite} />
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Fecha {formatarDataCurta(r.ciclo.data_fechamento)} · vence {formatarDataCurta(r.ciclo.data_vencimento)}
          {r.emAberto.length > 0 && <span className="font-semibold text-rose-600 dark:text-rose-400"> · {r.emAberto.length} fatura(s) em aberto</span>}
        </p>
      </button>
    )
  }

  /* ------------------------- Detalhe do cartão ------------------------ */
  const renderDetalhe = (c: CartaoComResumo, r: NonNullable<typeof resumo>) => {
    const listaFaturas = abaFaturas === 'proximas' ? r.proximas : r.anteriores
    const atual = r.atual
    const statusAtual = atual ? statusFatura(atual, dataHoje) : 'vazia'

    return (
      <>
        <section className="mb-5 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-extrabold">{c.nome}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {c.bandeira ? `${c.bandeira} · ` : ''}fecha dia {c.dia_fechamento} · vence dia {c.dia_vencimento}{c.ativo ? '' : ' · inativo'}
              </p>
            </div>
            <button type="button" onClick={() => setMenuCartao(c)} aria-label="Ações do cartão" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Icon name="more" size={20} />
            </button>
          </div>

          <div className="mt-4">
            <BarraLimite percentual={r.limite.percentualUtilizado} acima={r.limite.acimaDoLimite} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div><p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Limite</p><p className="mt-0.5 truncate text-sm font-bold tabular-nums">{formatarCentavos(reaisParaCentavos(Number(c.limite)))}</p></div>
            <div><p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Utilizado</p><p className="mt-0.5 truncate text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatarCentavos(r.limite.utilizadoCentavos)}</p></div>
            <div><p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Disponível</p><p className={`mt-0.5 truncate text-sm font-bold tabular-nums ${r.limite.acimaDoLimite ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{formatarCentavos(r.limite.disponivelCentavos)}</p></div>
          </div>
          {r.comprometidoFuturo > 0 && (
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300">
              Comprometido nas próximas faturas: <strong className="tabular-nums">{formatarCentavos(r.comprometidoFuturo)}</strong>
            </p>
          )}
        </section>

        {/* Fatura atual */}
        <section className="mb-5 rounded-3xl border border-sky-200 bg-sky-50/50 p-5 dark:border-sky-900/60 dark:bg-sky-950/20">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold capitalize">Fatura atual · {formatarMesCurto(r.ciclo.mes_referencia)}</p>
            <BadgeFatura status={statusAtual === 'vazia' ? 'aberta' : statusAtual} />
          </div>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">{formatarCentavos(atual?.totalCentavos ?? 0)}</p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
            Fecha {formatarData(r.ciclo.data_fechamento)} · vence {formatarData(r.ciclo.data_vencimento)}
          </p>
          <div className="mt-4 flex gap-2">
            {atual && (
              <button type="button" onClick={() => ir(`?id=${c.id}&fatura=${atual.id}`)} className="h-10 flex-1 rounded-xl border border-sky-300 bg-white text-sm font-bold text-sky-800 hover:bg-sky-50 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300">
                Ver compras
              </button>
            )}
            {c.ativo && (
              <button type="button" onClick={() => abrirLancamento({ tipo: 'despesa', formaPagamento: 'credito', cartaoId: c.id })} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 text-sm font-bold text-white hover:bg-sky-700">
                <Icon name="plus" size={16} />
                Nova compra
              </button>
            )}
          </div>
        </section>

        {r.emAberto.length > 0 && (
          <section className="mb-5 rounded-3xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
            <p className="mb-2 text-sm font-bold text-rose-700 dark:text-rose-300">Faturas a pagar</p>
            <ul className="divide-y divide-rose-100 overflow-hidden rounded-2xl bg-white dark:divide-slate-800 dark:bg-slate-900">
              {r.emAberto.map((f) => <LinhaFatura key={f.id} fatura={f} dataHoje={dataHoje} onAbrir={() => ir(`?id=${c.id}&fatura=${f.id}`)} />)}
            </ul>
          </section>
        )}

        <div role="tablist" aria-label="Faturas" className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/60 p-1 dark:bg-slate-800">
          {([['proximas', `Próximas (${r.proximas.length})`], ['anteriores', `Anteriores (${r.anteriores.length})`]] as const).map(([valor, rotulo]) => (
            <button key={valor} type="button" role="tab" aria-selected={abaFaturas === valor} onClick={() => setAbaFaturas(valor)} className={`min-h-10 rounded-xl text-sm font-bold transition ${abaFaturas === valor ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
              {rotulo}
            </button>
          ))}
        </div>
        {listaFaturas.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
            {abaFaturas === 'proximas' ? 'Nenhuma parcela em faturas futuras.' : 'Nenhuma fatura anterior.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {listaFaturas.map((f) => <LinhaFatura key={f.id} fatura={f} dataHoje={dataHoje} onAbrir={() => ir(`?id=${c.id}&fatura=${f.id}`)} />)}
          </ul>
        )}
      </>
    )
  }

  /* ------------------------- Detalhe da fatura ------------------------ */
  const renderFatura = (f: FaturaDetalhada) => {
    const status = statusFatura(f, dataHoje)
    const restante = restanteFaturaCentavos(f)
    return (
      <>
        <section className="mb-5 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold capitalize">Fatura de {formatarMesCurto(f.mes_referencia)}</h2>
            <BadgeFatura status={status} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {cartaoDaFatura?.nome ?? 'Cartão'} · fecha {formatarData(f.data_fechamento)} · vence {formatarData(f.data_vencimento)}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div><p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Total</p><p className="mt-0.5 truncate text-sm font-bold tabular-nums">{formatarCentavos(f.totalCentavos)}</p></div>
            <div><p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Pago</p><p className="mt-0.5 truncate text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{formatarCentavos(f.pagoCentavos)}</p></div>
            <div><p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Falta</p><p className="mt-0.5 truncate text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatarCentavos(restante)}</p></div>
          </div>
          {restante > 0 && (
            <button type="button" onClick={() => setPagando(true)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.99]">
              <Icon name="check" size={18} />
              Pagar fatura
            </button>
          )}
        </section>

        <section className="mb-5" aria-labelledby="titulo-compras">
          <h3 id="titulo-compras" className="mb-3 text-base font-bold">Compras ({f.compras.length})</h3>
          {f.compras.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-500 dark:border-slate-700">Nenhuma compra nesta fatura.</p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {f.compras.map((compra) => (
                <li key={compra.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{compra.nome}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {compra.data_compra ? formatarDataCurta(compra.data_compra) : ''}
                      {nomeCategoria(compra.categoria_id) ? ` · ${nomeCategoria(compra.categoria_id)}` : ''}
                      {compra.recorrencia_id ? ' · recorrente' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums">{formatarCentavos(reaisParaCentavos(Number(compra.valor_real ?? compra.valor_estimado)))}</span>
                  <button
                    type="button"
                    aria-label={`Editar ${compra.nome}`}
                    onClick={() => abrirLancamento({
                      tipo: 'despesa',
                      mes: f.mes_referencia,
                      transacao: { ...compra, tipo: 'despesa', mes_referencia: f.mes_referencia, status_pagamento: 'pendente', fatura_id: f.id, cartao_id: f.cartao_id },
                    })}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-slate-800"
                  >
                    <Icon name="pencil" size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir ${compra.nome}`}
                    onClick={() => operacoes.solicitarExclusao({ ...compra, status_pagamento: 'pendente', pago_em: null })}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-800"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {f.pagamentos.length > 0 && (
          <section aria-labelledby="titulo-pagamentos">
            <h3 id="titulo-pagamentos" className="mb-3 text-base font-bold">Pagamentos</h3>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {f.pagamentos.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"><Icon name="check" size={16} /></span>
                  <span className="min-w-0 flex-1 text-sm font-semibold">Pago em {formatarData(p.data_pagamento)}</span>
                  <span className="shrink-0 text-sm font-bold tabular-nums">{formatarCentavos(reaisParaCentavos(Number(p.valor)))}</span>
                  <button
                    type="button"
                    aria-label="Desfazer pagamento"
                    onClick={() => setConfirmacao({ titulo: 'Desfazer pagamento?', texto: `O pagamento de ${formatarCentavos(reaisParaCentavos(Number(p.valor)))} será removido e o valor volta a ficar em aberto.`, botao: 'Desfazer pagamento', acao: () => desfazerPagamentoFatura(p.id) })}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-800"
                  >
                    <Icon name="undo" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    )
  }

  const nivel = faturaId ? 'fatura' : cartaoId ? 'cartao' : 'lista'
  const voltar = () => (nivel === 'fatura' ? ir(cartaoId ? `?id=${cartaoId}` : '') : ir(''))

  return (
    <main>
      <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-5 sm:px-5">
        <header className="mb-6 flex items-center gap-3">
          {nivel !== 'lista' && (
            <button type="button" onClick={voltar} aria-label="Voltar" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
              <Icon name="arrow-left" size={18} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight">Cartões</h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {nivel === 'fatura' ? 'Compras e pagamentos da fatura' : nivel === 'cartao' ? 'Limite e faturas' : 'Limites, faturas e vencimentos'}
            </p>
          </div>
          {nivel === 'lista' && (
            <button type="button" onClick={() => setEditando('novo')} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-sky-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-sky-700 active:scale-95">
              <Icon name="plus" size={16} />
              Novo
            </button>
          )}
        </header>

        {loading ? (
          <p role="status" className="py-10 text-center text-sm text-slate-500">Carregando cartões...</p>
        ) : erro ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-6 text-center dark:border-rose-900 dark:bg-rose-950/30">
            <p className="text-sm text-rose-700 dark:text-rose-300">{erro}</p>
            <button type="button" onClick={() => { setLoading(true); recarregar() }} className="mt-2 text-sm font-bold text-emerald-700 underline dark:text-emerald-400">Tentar novamente</button>
          </div>
        ) : nivel === 'fatura' ? (
          carregandoFatura && !fatura ? (
            <p role="status" className="py-10 text-center text-sm text-slate-500">Carregando fatura...</p>
          ) : fatura && fatura.id === faturaId ? (
            renderFatura(fatura)
          ) : (
            <p className="py-10 text-center text-sm text-slate-500">Fatura não encontrada.</p>
          )
        ) : nivel === 'cartao' ? (
          selecionado && resumo ? renderDetalhe(selecionado, resumo) : <p className="py-10 text-center text-sm text-slate-500">Cartão não encontrado.</p>
        ) : cartoes.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 px-5 py-10 text-center dark:border-slate-700">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Nenhum cartão cadastrado</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Cadastre o dia de fechamento e de vencimento: o app escolhe a fatura de cada compra.</p>
            <button type="button" onClick={() => setEditando('novo')} className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-full bg-sky-600 px-4 text-xs font-bold text-white hover:bg-sky-700">
              <Icon name="plus" size={16} />
              Cadastrar cartão
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {ativos.map(renderCartao)}
            {inativos.length > 0 && (
              <>
                <p className="px-1 pt-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Inativos</p>
                {inativos.map(renderCartao)}
              </>
            )}
          </div>
        )}
      </div>

      {editando && (
        <CartaoModal
          cartao={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)}
          onSalvo={(mensagem) => {
            setEditando(null)
            mostrar(mensagem)
            notificarAlteracao()
          }}
        />
      )}

      {pagando && fatura && (
        <PagamentoFaturaModal
          faturaId={fatura.id}
          titulo={`${cartaoDaFatura?.nome ?? 'Cartão'} · ${formatarMesCurto(fatura.mes_referencia)}`}
          restanteCentavos={restanteFaturaCentavos(fatura)}
          onClose={() => setPagando(false)}
          onSalvo={(mensagem) => {
            setPagando(false)
            mostrar(mensagem)
            notificarAlteracao()
          }}
        />
      )}

      <ConfirmDialog
        aberto={!!menuCartao}
        titulo={menuCartao?.nome ?? ''}
        acoes={menuCartao ? acoesCartao(menuCartao) : []}
        onFechar={() => !processando && setMenuCartao(null)}
        carregando={processando}
        rotuloCancelar="Fechar"
      />
      <ConfirmDialog
        aberto={!!confirmacao}
        titulo={confirmacao?.titulo ?? ''}
        descricao={confirmacao?.texto}
        acoes={confirmacao ? [{ label: confirmacao.botao, variante: 'perigo', onClick: () => void executar(confirmacao.acao, confirmacao.aoConcluir) }] : []}
        onFechar={() => !processando && setConfirmacao(null)}
        carregando={processando}
      />
      {operacoes.dialogo}
    </main>
  )
}

export default function PaginaCartoes() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-slate-500">Carregando...</p>}>
      <ConteudoCartoes />
    </Suspense>
  )
}
