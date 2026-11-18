'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { buscarParcelamentos } from '@/app/actions'
import BadgeSituacao from '@/app/components/BadgeSituacao'
import Icon from '@/app/components/Icon'
import Toast, { useToast } from '@/app/components/Toast'
import TransactionModal from '@/app/components/TransactionModal'
import { formatarDataPagamento, useOperacoesTransacao } from '@/app/components/useOperacoesTransacao'
import { compararMeses, formatarMes, formatarMesCurto, mesCorrente } from '@/app/lib/meses'
import { formatarCentavos } from '@/app/lib/money'
import {
  agruparParcelasPorAno,
  ordenarParcelas,
  parcelasAfetadasPorEdicaoFutura,
  resumirParcelamento,
  situacaoParcela,
  valorEfetivoCentavos,
  type ResumoParcelamento,
} from '@/app/lib/parcelamentos'
import {
  nomeBaseParcela,
  nomeCategoria,
  type Parcela,
  type ParcelamentoComParcelas,
} from '@/app/lib/types'

interface ParcelamentoResumido {
  parcelamento: ParcelamentoComParcelas
  resumo: ResumoParcelamento
  categoria: string | null
}

function BarraProgresso({ resumo, rotulo }: { resumo: ResumoParcelamento; rotulo: string }) {
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={resumo.totalParcelas}
      aria-valuenow={resumo.pagas}
      aria-valuetext={`${resumo.pagas} de ${resumo.totalParcelas} parcelas pagas`}
    >
      <div
        className={`h-full rounded-full transition-all ${resumo.finalizado ? 'bg-emerald-500' : 'bg-violet-500'}`}
        style={{ width: `${resumo.progresso}%` }}
      />
    </div>
  )
}

function Estatistica({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{rotulo}</p>
      <p className={`mt-0.5 truncate text-sm font-bold tabular-nums ${destaque ?? ''}`}>{valor}</p>
    </div>
  )
}

function CartaoParcelamento({
  item,
  mesHoje,
  onAbrir,
}: {
  item: ParcelamentoResumido
  mesHoje: string
  onAbrir: () => void
}) {
  const { parcelamento, resumo, categoria } = item
  const proxima = resumo.proxima
  const situacaoProxima = proxima ? situacaoParcela(proxima, mesHoje) : null

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="w-full rounded-3xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-[0.995] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold">{parcelamento.nome}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {categoria ? `${categoria} · ` : ''}
            {resumo.totalParcelas}x {resumo.valoresDiferentes ? 'a partir de ' : 'de '}
            {formatarCentavos(resumo.valorParcelaCentavos)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums">{formatarCentavos(resumo.valorTotalCentavos)}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">total</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-semibold">
            {resumo.pagas} de {resumo.totalParcelas} pagas
          </span>
          <span className="text-slate-500 dark:text-slate-400">{resumo.progresso}%</span>
        </div>
        <BarraProgresso resumo={resumo} rotulo={`Progresso de ${parcelamento.nome}`} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Estatistica rotulo="Pendentes" valor={String(resumo.pendentes)} />
        <Estatistica rotulo="Restante" valor={formatarCentavos(resumo.valorRestanteCentavos)} destaque="text-rose-600 dark:text-rose-400" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Próxima</p>
          {proxima ? (
            <p className="mt-0.5 flex items-center gap-1 truncate text-sm font-bold capitalize">
              {formatarMesCurto(proxima.mes_referencia)}
              {situacaoProxima === 'vencida' && <BadgeSituacao situacao="vencida" />}
            </p>
          ) : (
            <p className="mt-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">Quitado</p>
          )}
        </div>
      </div>

      {resumo.semStatus > 0 && (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-950 dark:text-slate-400">
          {resumo.semStatus} {resumo.semStatus === 1 ? 'parcela antiga sem' : 'parcelas antigas sem'} status de pagamento. Abra para marcar as que já foram pagas.
        </p>
      )}
    </button>
  )
}

function LinhaParcela({
  parcela,
  total,
  mesHoje,
  pagando,
  onPagamento,
  onEditar,
  onExcluir,
}: {
  parcela: Parcela
  total: number
  mesHoje: string
  pagando: boolean
  onPagamento: () => void
  onEditar: () => void
  onExcluir: () => void
}) {
  const situacao = situacaoParcela(parcela, mesHoje)
  const paga = situacao === 'paga'
  const atual = parcela.mes_referencia === mesHoje

  return (
    <li className={`flex items-center gap-3 px-4 py-3.5 ${atual ? 'bg-violet-50/60 dark:bg-violet-950/20' : ''}`}>
      <button
        type="button"
        onClick={onPagamento}
        disabled={pagando}
        aria-pressed={paga}
        aria-label={paga ? `Desfazer pagamento da parcela ${parcela.numero_parcela}` : `Marcar parcela ${parcela.numero_parcela} como paga`}
        title={paga ? 'Desfazer pagamento' : 'Marcar como paga'}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition disabled:opacity-50 ${
          paga
            ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
            : situacao === 'vencida'
              ? 'border-amber-400 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40'
              : 'border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500 dark:border-slate-600'
        }`}
      >
        {pagando ? (
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <Icon name={situacao === 'vencida' ? 'clock' : 'check'} size={18} />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold capitalize">
          {formatarMes(parcela.mes_referencia)}
          {atual && <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold normal-case text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">mês atual</span>}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span>Parcela {parcela.numero_parcela ?? '?'}/{total}</span>
          <BadgeSituacao situacao={situacao} />
        </p>
        {paga && parcela.pago_em && (
          <p className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
            Paga em {formatarDataPagamento(parcela.pago_em)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className={`text-sm font-bold tabular-nums ${paga ? 'text-slate-400 line-through decoration-1 dark:text-slate-500' : ''}`}>
          {formatarCentavos(valorEfetivoCentavos(parcela))}
        </p>
        <div className="flex items-center">
          <button type="button" onClick={onEditar} aria-label={`Editar parcela ${parcela.numero_parcela}`} title="Editar" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-slate-800 dark:hover:text-sky-400">
            <Icon name="pencil" size={15} />
          </button>
          <button type="button" onClick={onExcluir} aria-label={`Excluir parcela ${parcela.numero_parcela}`} title="Excluir" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-800 dark:hover:text-rose-400">
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>
    </li>
  )
}

interface EstadoModal {
  parcela: Parcela
  parcelamentoId: string
  total: number
  futuras: number
}

function ConteudoParcelamentos() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selecionadoId = searchParams.get('id')

  const [parcelamentos, setParcelamentos] = useState<ParcelamentoComParcelas[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const [aba, setAba] = useState<'ativos' | 'finalizados'>('ativos')
  const [modal, setModal] = useState<EstadoModal | null>(null)

  const { toast, mostrar, fechar } = useToast()
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])
  const operacoes = useOperacoesTransacao({ onConcluido: recarregar, mostrarMensagem: mostrar })

  const mesHoje = mesCorrente()

  useEffect(() => {
    let cancelado = false

    buscarParcelamentos()
      .then((dados) => {
        if (cancelado) return
        setParcelamentos(dados)
        setErro(null)
      })
      .catch((error) => {
        if (cancelado) return
        console.error(error)
        setErro(error instanceof Error ? error.message : 'Não foi possível carregar seus parcelamentos.')
      })
      .finally(() => {
        if (!cancelado) setLoading(false)
      })

    return () => {
      cancelado = true
    }
  }, [versao])

  const itens = useMemo<ParcelamentoResumido[]>(
    () =>
      parcelamentos.map((parcelamento) => ({
        parcelamento,
        resumo: resumirParcelamento(parcelamento, mesHoje),
        categoria: nomeCategoria(parcelamento.parcelas[0]?.categoria_id ?? null),
      })),
    [parcelamentos, mesHoje]
  )

  const ativos = useMemo(
    () =>
      itens
        .filter((item) => !item.resumo.finalizado)
        .sort((a, b) =>
          compararMeses(
            a.resumo.proxima?.mes_referencia ?? '9999-12',
            b.resumo.proxima?.mes_referencia ?? '9999-12'
          )
        ),
    [itens]
  )

  const finalizados = useMemo(
    () =>
      itens
        .filter((item) => item.resumo.finalizado)
        .sort((a, b) => {
          const ultimoA = ordenarParcelas(a.parcelamento.parcelas).at(-1)?.mes_referencia ?? '0000-01'
          const ultimoB = ordenarParcelas(b.parcelamento.parcelas).at(-1)?.mes_referencia ?? '0000-01'
          return compararMeses(ultimoB, ultimoA)
        }),
    [itens]
  )

  const restanteTotal = ativos.reduce((total, item) => total + item.resumo.valorRestanteCentavos, 0)
  const selecionado = selecionadoId ? itens.find((item) => item.parcelamento.id === selecionadoId) ?? null : null

  const abrir = (id: string) => router.push(`/parcelamentos?id=${encodeURIComponent(id)}`, { scroll: true })
  const voltarParaLista = () => router.push('/parcelamentos', { scroll: true })

  /* ------------------------------------------------------------------ */
  /* Detalhe                                                             */
  /* ------------------------------------------------------------------ */
  const renderDetalhe = ({ parcelamento, resumo, categoria }: ParcelamentoResumido) => {
    const grupos = agruparParcelasPorAno(parcelamento.parcelas)
    const total = resumo.totalParcelas

    return (
      <>
        <section className="mb-5 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-extrabold">{parcelamento.nome}</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {categoria ?? 'Despesa'} · {total}x {resumo.valoresDiferentes ? 'a partir de ' : 'de '}
                {formatarCentavos(resumo.valorParcelaCentavos)}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                resumo.finalizado
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                  : 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'
              }`}
            >
              {resumo.finalizado ? 'Finalizado' : 'Ativo'}
            </span>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-semibold">{resumo.pagas} de {total} parcelas pagas</span>
              <span className="text-slate-500 dark:text-slate-400">{resumo.progresso}%</span>
            </div>
            <BarraProgresso resumo={resumo} rotulo={`Progresso de ${parcelamento.nome}`} />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Estatistica rotulo="Valor total (parcelas)" valor={formatarCentavos(resumo.valorTotalCentavos)} />
            <Estatistica rotulo="Valor da parcela" valor={`${resumo.valoresDiferentes ? 'a partir de ' : ''}${formatarCentavos(resumo.valorParcelaCentavos)}`} />
            <Estatistica rotulo="Pago" valor={formatarCentavos(resumo.valorPagoCentavos)} destaque="text-emerald-700 dark:text-emerald-400" />
            <Estatistica rotulo="Restante" valor={formatarCentavos(resumo.valorRestanteCentavos)} destaque="text-rose-600 dark:text-rose-400" />
            <Estatistica rotulo="Parcelas pagas" valor={String(resumo.pagas)} />
            <Estatistica
              rotulo="Parcelas pendentes"
              valor={`${resumo.pendentes}${resumo.vencidas ? ` (${resumo.vencidas} vencida${resumo.vencidas > 1 ? 's' : ''})` : ''}`}
              destaque={resumo.vencidas ? 'text-amber-600 dark:text-amber-400' : undefined}
            />
          </div>

          {resumo.valorContratadoCentavos !== null && resumo.diferencaContratadoCentavos !== 0 && (
            <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <span className="font-bold">Valor contratado: {formatarCentavos(resumo.valorContratadoCentavos)}.</span>{' '}
              A soma das parcelas atuais é {formatarCentavos(resumo.valorTotalCentavos)}
              {' '}({(resumo.diferencaContratadoCentavos ?? 0) > 0 ? 'menos' : 'mais'}{' '}
              {formatarCentavos(Math.abs(resumo.diferencaContratadoCentavos ?? 0))}), porque parcelas foram editadas ou excluídas.
            </p>
          )}

          {resumo.proxima && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
              <Icon name="calendar" size={18} />
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">Próxima parcela: </span>
                <span className="capitalize">{formatarMes(resumo.proxima.mes_referencia)}</span>
                {' · '}
                <span className="font-bold tabular-nums">{formatarCentavos(valorEfetivoCentavos(resumo.proxima))}</span>
              </p>
            </div>
          )}

          {resumo.semStatus > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {resumo.semStatus} {resumo.semStatus === 1 ? 'parcela foi criada' : 'parcelas foram criadas'} antes do controle de pagamento e {resumo.semStatus === 1 ? 'aparece' : 'aparecem'} como “Sem status”.
              O sistema não presume se foram pagas: toque no círculo para marcar as que você já pagou.
            </p>
          )}
        </section>

        <section aria-labelledby="titulo-parcelas" className="mb-6">
          <h3 id="titulo-parcelas" className="mb-3 text-base font-bold">Parcelas</h3>
          <div className="space-y-4">
            {grupos.map((grupo) => (
              <div key={grupo.ano}>
                <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{grupo.ano}</p>
                <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                  {grupo.parcelas.map((parcela) => (
                    <LinhaParcela
                      key={parcela.id}
                      parcela={parcela}
                      total={total}
                      mesHoje={mesHoje}
                      pagando={operacoes.pagandoId === parcela.id}
                      onPagamento={() => operacoes.alternarPagamento({ ...parcela, parcelamento_id: parcelamento.id })}
                      onEditar={() => {
                        setModal({
                          parcela,
                          parcelamentoId: parcelamento.id,
                          total,
                          futuras: parcelasAfetadasPorEdicaoFutura(parcelamento.parcelas, parcela.numero_parcela ?? 0).length,
                        })
                      }}
                      onExcluir={() =>
                        operacoes.solicitarExclusao(
                          { ...parcela, parcelamento_id: parcelamento.id },
                          { totalParcelas: total, parcelasPagas: resumo.pagas }
                        )
                      }
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={() =>
            operacoes.solicitarExclusaoParcelamento(parcelamento.id, parcelamento.nome, {
              totalParcelas: total,
              parcelasPagas: resumo.pagas,
            })
          }
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 text-sm font-bold text-rose-600 transition hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/30"
        >
          <Icon name="trash" size={16} />
          Excluir parcelamento inteiro
        </button>
      </>
    )
  }

  /* ------------------------------------------------------------------ */
  /* Lista                                                               */
  /* ------------------------------------------------------------------ */
  const renderLista = () => {
    const lista = aba === 'ativos' ? ativos : finalizados

    return (
      <>
        <section className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Ativos</p>
            <p className="mt-1 text-lg font-bold">{ativos.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Restante a pagar</p>
            <p className="mt-1 break-words text-lg font-bold text-rose-600 dark:text-rose-400">{formatarCentavos(restanteTotal)}</p>
          </div>
        </section>

        <div role="tablist" aria-label="Situação dos parcelamentos" className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/60 p-1 dark:bg-slate-800">
          {([
            ['ativos', `Ativos (${ativos.length})`],
            ['finalizados', `Finalizados (${finalizados.length})`],
          ] as const).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              role="tab"
              id={`aba-${valor}`}
              aria-selected={aba === valor}
              aria-controls="painel-parcelamentos"
              onClick={() => setAba(valor)}
              className={`min-h-10 rounded-xl text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                aba === valor
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <div id="painel-parcelamentos" role="tabpanel" aria-labelledby={`aba-${aba}`} className="space-y-3">
          {lista.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 px-5 py-10 text-center dark:border-slate-700">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {aba === 'ativos' ? 'Nenhum parcelamento ativo' : 'Nenhum parcelamento finalizado'}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {aba === 'ativos'
                  ? 'Crie uma despesa e ative “Compra parcelada”.'
                  : 'Parcelamentos com todas as parcelas pagas aparecem aqui.'}
              </p>
            </div>
          ) : (
            lista.map((item) => (
              <CartaoParcelamento key={item.parcelamento.id} item={item} mesHoje={mesHoje} onAbrir={() => abrir(item.parcelamento.id)} />
            ))
          )}
        </div>
      </>
    )
  }

  const emDetalhe = !!selecionadoId

  return (
    <main className="min-h-screen bg-slate-50 pb-16 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-5 sm:px-5">
        <header className="mb-6 flex items-center gap-3">
          {emDetalhe ? (
            <button
              type="button"
              onClick={voltarParaLista}
              aria-label="Voltar para a lista de parcelamentos"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Icon name="arrow-left" size={18} />
            </button>
          ) : (
            <Link
              href="/"
              aria-label="Voltar para o início"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Icon name="arrow-left" size={18} />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight">Parcelamentos</h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {emDetalhe ? 'Detalhes e parcelas' : 'Acompanhe suas compras parceladas.'}
            </p>
          </div>
        </header>

        {loading ? (
          <p role="status" className="py-10 text-center text-sm text-slate-500">Carregando parcelamentos...</p>
        ) : erro ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-6 text-center dark:border-rose-900 dark:bg-rose-950/30">
            <p className="text-sm text-rose-700 dark:text-rose-300">{erro}</p>
            <button type="button" onClick={() => { setLoading(true); recarregar() }} className="mt-2 text-sm font-bold text-emerald-700 underline dark:text-emerald-400">
              Tentar novamente
            </button>
          </div>
        ) : emDetalhe ? (
          selecionado ? (
            renderDetalhe(selecionado)
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-300 px-5 py-10 text-center dark:border-slate-700">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Parcelamento não encontrado.</p>
              <button type="button" onClick={voltarParaLista} className="mt-2 text-sm font-bold text-emerald-700 underline dark:text-emerald-400">
                Ver todos os parcelamentos
              </button>
            </div>
          )
        ) : (
          renderLista()
        )}
      </div>

      {modal && (
        <TransactionModal
          onClose={() => setModal(null)}
          onSalvo={(mensagem) => {
            setModal(null)
            mostrar(mensagem)
            recarregar()
          }}
          tipo={modal.parcela.tipo}
          mesAtual={modal.parcela.mes_referencia}
          transacaoParaEditar={{
            ...modal.parcela,
            nome: nomeBaseParcela(modal.parcela.nome),
            parcelamento_id: modal.parcelamentoId,
          }}
          totalParcelas={modal.total}
          parcelasFuturasAfetadas={modal.futuras}
        />
      )}

      {operacoes.dialogo}
      <Toast toast={toast} onFechar={fechar} />
    </main>
  )
}

export default function PaginaParcelamentos() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-slate-500">Carregando...</p>}>
      <ConteudoParcelamentos />
    </Suspense>
  )
}
