'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buscarPainel, type Painel } from '@/app/actions';
import { useApp } from '@/app/components/AppShell';
import BadgeSituacao from '@/app/components/BadgeSituacao';
import Icon, { type IconName } from '@/app/components/Icon';
import { formatarDataPagamento, useOperacoesTransacao } from '@/app/components/useOperacoesTransacao';
import { ROTULO_STATUS_FATURA } from '@/app/lib/cartoes';
import { compararDatas, descreverPrazo, formatarDataCurta } from '@/app/lib/datas';
import { adicionarMeses, formatarMes, formatarMesCurto, mesCorrente, normalizarMes } from '@/app/lib/meses';
import { formatarCentavos, reaisParaCentavos } from '@/app/lib/money';
import type { Compromisso, OrigemCompromisso } from '@/app/lib/painel';
import { situacaoParcela } from '@/app/lib/parcelamentos';
import { CATEGORIAS, nomeCategoria, type TipoTransacao, type Transacao } from '@/app/lib/types';

const ICONE_ORIGEM: Record<OrigemCompromisso, IconName> = {
  recorrente: 'repeat',
  parcela: 'layers',
  avulsa: 'receipt',
  fatura: 'credit-card',
};

const COR_ORIGEM: Record<OrigemCompromisso, string> = {
  recorrente: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400',
  parcela: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
  avulsa: 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
  fatura: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400',
};

const CORES_CATEGORIA: Record<number, string> = { 1: 'bg-sky-500', 2: 'bg-violet-500', 3: 'bg-emerald-500' };

/** Extrai o total de parcelas do sufixo "(3/12)" do nome (apenas exibição). */
function totalDoNome(nome: string): number | undefined {
  const correspondencia = nome.match(/\((\d+)\/(\d+)\)\s*$/);
  return correspondencia ? Number(correspondencia[2]) : undefined;
}

function valorCentavos(transacao: Transacao) {
  return reaisParaCentavos(Number(transacao.valor_real ?? transacao.valor_estimado));
}

function Indicador({ rotulo, valor, detalhe, icone, cor }: { rotulo: string; valor: string; detalhe?: string; icone: IconName; cor: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2.5 flex items-center gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${cor}`}>
          <Icon name={icone} size={17} />
        </span>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{rotulo}</span>
      </div>
      <p className="break-words text-lg font-bold tracking-tight tabular-nums">{valor}</p>
      {detalhe && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{detalhe}</p>}
    </div>
  );
}

function CategoryProgress({ title, valueCentavos, percentage, color }: { title: string; valueCentavos: number; percentage: number; color: string }) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums">{formatarCentavos(valueCentavos)}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{percentage.toFixed(1)}% da receita</p>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label={`${title}: ${percentage.toFixed(1)}% da receita`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(percentage, 100))}>
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(percentage, 100)}%` }} />
      </div>
    </div>
  );
}

function LinhaTransacao({ transacao, ultima, mesHoje, pagando, onEditar, onExcluir, onPagamento }: {
  transacao: Transacao;
  ultima: boolean;
  mesHoje: string;
  pagando: boolean;
  onEditar: () => void;
  onExcluir: () => void;
  onPagamento: () => void;
}) {
  const receita = transacao.tipo === 'receita';
  const ehParcela = !!transacao.parcelamento_id;
  const ehRecorrente = !!transacao.recorrencia_id;
  const paga = transacao.status_pagamento === 'pago';
  // Parcelas e recorrentes mostram sempre a situação; avulsas, só quando pagas.
  const situacao = !receita && (ehParcela || ehRecorrente || paga) ? situacaoParcela(transacao, mesHoje) : null;

  const detalhes = [
    receita ? null : nomeCategoria(transacao.categoria_id) || 'Despesa',
    ehRecorrente ? 'Recorrente' : ehParcela ? 'Parcela' : null,
    transacao.data_vencimento ? `vence ${formatarDataCurta(transacao.data_vencimento)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 ${!ultima ? 'border-b border-slate-100 dark:border-slate-800' : ''} ${paga ? 'opacity-70' : ''}`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${receita ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : COR_ORIGEM[ehRecorrente ? 'recorrente' : ehParcela ? 'parcela' : 'avulsa']}`}>
        <Icon name={ehParcela ? 'layers' : ehRecorrente ? 'repeat' : receita ? 'arrow-down-left' : 'arrow-up-right'} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${paga ? 'line-through decoration-slate-400' : ''}`}>{transacao.nome}</p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          {situacao && <BadgeSituacao situacao={situacao} />}
          <span className="truncate">
            {detalhes}
            {paga && transacao.pago_em ? ` · paga em ${formatarDataPagamento(transacao.pago_em)}` : ''}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <p className={`text-sm font-bold tabular-nums ${receita ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {receita ? '+' : '−'}{formatarCentavos(valorCentavos(transacao))}
        </p>
        <div className="flex items-center gap-0.5">
          {!receita && (
            <button
              type="button"
              onClick={onPagamento}
              disabled={pagando}
              aria-pressed={paga}
              aria-label={paga ? `Desfazer pagamento de ${transacao.nome}` : `Marcar ${transacao.nome} como paga`}
              title={paga ? 'Desfazer pagamento' : 'Marcar como paga'}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition disabled:opacity-50 ${paga ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-400' : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-800 dark:hover:text-emerald-400'}`}
            >
              <Icon name="check" size={16} />
            </button>
          )}
          <button type="button" onClick={onEditar} aria-label={`Editar ${transacao.nome}`} title="Editar" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-slate-800 dark:hover:text-sky-400">
            <Icon name="pencil" size={15} />
          </button>
          <button type="button" onClick={onExcluir} aria-label={`Excluir ${transacao.nome}`} title="Excluir" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-800 dark:hover:text-rose-400">
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function LinhaCompromisso({ compromisso, hoje, pagando, onPagar }: { compromisso: Compromisso; hoje: string; pagando: boolean; onPagar: () => void }) {
  const c = compromisso;
  const prazo = c.data ? descreverPrazo(c.data, hoje) : null;
  const conteudo = (
    <>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${COR_ORIGEM[c.origem]}`}>
        <Icon name={ICONE_ORIGEM[c.origem]} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{c.nome}</span>
        <span className={`block text-xs ${c.vencida ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {c.vencida
            ? `Vencida${prazo ? ` ${prazo}` : ''}`
            : c.data
              ? `Vence ${prazo} · ${formatarDataCurta(c.data)}`
              : `Em ${formatarMesCurto(c.mes_referencia)}`}
        </span>
      </span>
      <span className="shrink-0 text-sm font-bold tabular-nums">{formatarCentavos(c.valorCentavos)}</span>
    </>
  );

  if (c.tipo === 'fatura') {
    return (
      <li>
        <Link href={`/cartoes?id=${c.cartao_id}&fatura=${c.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
          {conteudo}
          <Icon name="chevron-right" size={16} />
        </Link>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {conteudo}
      <button
        type="button"
        onClick={onPagar}
        disabled={pagando}
        aria-label={`Marcar ${c.nome} como paga`}
        title="Marcar como paga"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-emerald-400"
      >
        <Icon name="check" size={16} />
      </button>
    </li>
  );
}

/** Pendentes primeiro (por vencimento), pagas por último. */
function ordenarDespesas(lista: Transacao[]) {
  const peso = (t: Transacao) => (t.status_pagamento === 'pago' ? 1 : 0);
  return [...lista].sort((a, b) => peso(a) - peso(b) || (a.data_vencimento ?? '9999').localeCompare(b.data_vencimento ?? '9999'));
}

export default function Dashboard() {
  const app = useApp();
  const { mostrar, versaoDados, notificarAlteracao, setMesSelecionado } = app;
  const [mesAtual, setMesAtual] = useState(() => app.mesSelecionado);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [loading, setLoading] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const seletorMesRef = useRef<HTMLInputElement>(null);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const operacoes = useOperacoesTransacao({ onConcluido: notificarAlteracao, mostrarMensagem: mostrar });
  const mesHoje = mesCorrente();

  useEffect(() => {
    let cancelado = false;
    buscarPainel(mesAtual)
      .then((dados) => {
        if (cancelado) return;
        setPainel(dados);
        setErroCarregamento(null);
      })
      .catch((error) => {
        if (cancelado) return;
        console.error('Erro ao carregar o painel:', error);
        setErroCarregamento('Não foi possível carregar suas finanças.');
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [mesAtual, versao, versaoDados]);

  const irParaMes = (mes: string) => {
    if (mes === mesAtual) return;
    setLoading(true);
    setMesAtual(mes);
    setMesSelecionado(mes);
  };

  const abrirEdicao = (tipo: TipoTransacao, transacao: Transacao) =>
    app.abrirLancamento({ tipo, transacao, totalParcelas: transacao.parcelamento_id ? totalDoNome(transacao.nome) : undefined });

  const doMes = painel?.mes === mesAtual ? painel : null;
  const transacoes = doMes?.transacoes ?? [];
  const resumo = doMes?.resumo ?? null;
  const listaReceitas = transacoes.filter((t) => t.tipo === 'receita');
  // Compras no cartão aparecem agrupadas na fatura (evita duplicidade visual).
  const listaDespesas = ordenarDespesas(transacoes.filter((t) => t.tipo === 'despesa' && !t.fatura_id));
  const comprasNoCartao = transacoes.filter((t) => t.fatura_id).length;
  const percentual = (valor: number) => (resumo && resumo.receitasCentavos > 0 ? (valor / resumo.receitasCentavos) * 100 : 0);
  const maiorFuturo = Math.max(1, ...(painel?.futuros ?? []).map((m) => m.totalCentavos));

  const mesAnterior = adicionarMeses(mesAtual, -1);
  const proximoMes = adicionarMeses(mesAtual, 1);
  const carregandoMes = loading || !resumo;

  const renderLista = (lista: Transacao[], tipo: TipoTransacao) => {
    if (carregandoMes) return <div className="px-5 py-6 text-center text-sm text-slate-500" role="status">Carregando...</div>;
    if (lista.length === 0) {
      return (
        <div className="px-5 py-7 text-center">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Nenhuma {tipo} neste mês</p>
          <button type="button" onClick={() => app.abrirLancamento({ tipo, mes: mesAtual })} className="mt-2 text-xs font-bold text-emerald-700 underline dark:text-emerald-400">
            {tipo === 'receita' ? 'Adicionar receita' : 'Adicionar despesa'}
          </button>
        </div>
      );
    }
    return lista.map((transacao, index) => (
      <LinhaTransacao
        key={transacao.id}
        transacao={transacao}
        ultima={index === lista.length - 1}
        mesHoje={mesHoje}
        pagando={operacoes.pagandoId === transacao.id}
        onEditar={() => abrirEdicao(transacao.tipo, transacao)}
        onExcluir={() => operacoes.solicitarExclusao(transacao, { totalParcelas: totalDoNome(transacao.nome) })}
        onPagamento={() => operacoes.alternarPagamento(transacao)}
      />
    ));
  };

  return (
    <main>
      <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-5 sm:px-5">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
              <Icon name="wallet" size={19} />
            </span>
            <h1 className="text-xl font-extrabold tracking-tight">Finance</h1>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            <Icon name="user" size={18} />
          </div>
        </header>

        {/* Navegação mensal */}
        <nav aria-label="Navegação mensal" className="mb-4 flex items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <button type="button" aria-label={`Mês anterior: ${formatarMes(mesAnterior)}`} onClick={() => irParaMes(mesAnterior)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800">
            <Icon name="chevron-left" size={20} />
          </button>
          <div className="relative flex min-w-0 flex-1 flex-col items-center">
            <button
              type="button"
              onClick={() => {
                const campo = seletorMesRef.current;
                if (!campo) return;
                try {
                  campo.showPicker();
                } catch {
                  campo.focus();
                }
              }}
              aria-label={`Escolher mês. Mês selecionado: ${formatarMes(mesAtual)}`}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-bold capitalize transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-slate-800"
            >
              <span aria-live="polite">{formatarMes(mesAtual)}</span>
              <Icon name="calendar" size={14} />
            </button>
            {mesAtual !== mesHoje && (
              <button type="button" onClick={() => irParaMes(mesHoje)} className="text-[11px] font-bold text-emerald-700 hover:underline dark:text-emerald-400">
                Voltar para o mês atual
              </button>
            )}
            <input
              ref={seletorMesRef}
              type="month"
              value={mesAtual}
              onChange={(e) => {
                const m = normalizarMes(e.target.value);
                if (m) irParaMes(m);
              }}
              tabIndex={-1}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0"
            />
          </div>
          <button type="button" aria-label={`Próximo mês: ${formatarMes(proximoMes)}`} onClick={() => irParaMes(proximoMes)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800">
            <Icon name="chevron-right" size={20} />
          </button>
        </nav>

        {erroCarregamento && (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {erroCarregamento}{' '}
            <button type="button" onClick={() => { setLoading(true); recarregar(); }} className="font-bold underline">
              Tentar novamente
            </button>
          </div>
        )}

        {/* 1. Saldo disponível */}
        <section className="mb-3 overflow-hidden rounded-[28px] bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-500 p-5 text-white shadow-lg shadow-emerald-900/10" aria-busy={carregandoMes}>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-50/90">
            <Icon name="wallet" size={16} />
            Disponível agora
          </p>
          <h2 className="mt-2 break-words text-3xl font-bold tracking-tight tabular-nums">
            {resumo ? formatarCentavos(resumo.disponivelCentavos) : '—'}
          </h2>
          <p className="mt-1 text-xs text-emerald-50/80">Receitas do mês menos o que já foi pago</p>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/15 px-3 py-2 text-xs">
            <span>Previsto para o fim do mês</span>
            <strong className="tabular-nums">{resumo ? formatarCentavos(resumo.saldoPrevistoCentavos) : '—'}</strong>
          </div>
        </section>

        {/* 2-5. Indicadores */}
        <section className="mb-5 grid grid-cols-2 gap-3">
          <Indicador rotulo="Receitas" valor={resumo ? formatarCentavos(resumo.receitasCentavos) : '—'} icone="arrow-down-left" cor="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" />
          <Indicador
            rotulo="Despesas"
            valor={resumo ? formatarCentavos(resumo.despesasCentavos) : '—'}
            detalhe={comprasNoCartao ? `inclui ${comprasNoCartao} no cartão` : undefined}
            icone="arrow-up-right"
            cor="bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400"
          />
          <Indicador
            rotulo="A pagar"
            valor={resumo ? formatarCentavos(resumo.aPagarCentavos) : '—'}
            detalhe={resumo ? `${resumo.contasPendentes} ${resumo.contasPendentes === 1 ? 'conta pendente' : 'contas pendentes'}` : undefined}
            icone="clock"
            cor="bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
          />
          <Indicador
            rotulo="Faturas em aberto"
            valor={resumo ? formatarCentavos(resumo.faturasEmAbertoCentavos) : '—'}
            detalhe={doMes?.faturasDoMes.length ? 'vencem neste mês' : 'nenhuma neste mês'}
            icone="credit-card"
            cor="bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400"
          />
        </section>

        {/* 6. Próximos vencimentos */}
        <section className="mb-5" aria-labelledby="titulo-proximos">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="titulo-proximos" className="text-base font-bold">Próximos vencimentos</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">próximos 30 dias</span>
          </div>
          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {!painel ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500" role="status">Carregando...</p>
            ) : painel.proximos.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Nada vencendo nos próximos 30 dias.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {painel.proximos.map((c) => (
                  <LinhaCompromisso
                    key={c.chave}
                    compromisso={c}
                    hoje={painel.hoje}
                    pagando={operacoes.pagandoId === c.id}
                    onPagar={() => operacoes.alternarPagamento({ id: c.id, nome: c.nome, parcelamento_id: null, numero_parcela: null, status_pagamento: 'pendente', pago_em: null })}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 7. Compromissos futuros */}
        {painel && painel.futuros.some((m) => m.totalCentavos > 0) && (
          <section className="mb-5 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" aria-labelledby="titulo-futuros">
            <h2 id="titulo-futuros" className="font-bold">Compromissos futuros</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Contas pendentes, parcelas e faturas já previstas.</p>
            <ul className="mt-4 space-y-2.5">
              {painel.futuros.map((m) => (
                <li key={m.mes}>
                  <button
                    type="button"
                    onClick={() => irParaMes(m.mes)}
                    className="grid w-full grid-cols-[4.5rem_1fr_auto] items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    aria-label={`${formatarMes(m.mes)}: ${formatarCentavos(m.totalCentavos)}. Ver o mês.`}
                  >
                    <span className="text-xs font-semibold capitalize text-slate-500 dark:text-slate-400">{formatarMesCurto(m.mes)}</span>
                    <span className="flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <span className="h-full bg-amber-400" style={{ width: `${(m.contasCentavos / maiorFuturo) * 100}%` }} />
                      <span className="h-full bg-sky-500" style={{ width: `${(m.faturasCentavos / maiorFuturo) * 100}%` }} />
                    </span>
                    <span className="text-xs font-bold tabular-nums">{formatarCentavos(m.totalCentavos)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-4 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />Contas e parcelas</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-500" />Faturas</span>
            </div>
          </section>
        )}

        {/* Gastos por categoria */}
        <section className="mb-5 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">Gastos por categoria</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Em relação às receitas do mês.</p>
            </div>
            <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">50 / 30 / 20</span>
          </div>
          <div className="space-y-5">
            {CATEGORIAS.map((c) => (
              <CategoryProgress
                key={c.id}
                title={c.nome}
                valueCentavos={resumo?.porCategoria[c.id] ?? 0}
                percentage={percentual(resumo?.porCategoria[c.id] ?? 0)}
                color={CORES_CATEGORIA[c.id]}
              />
            ))}
          </div>
        </section>

        {/* Faturas do mês */}
        {doMes && doMes.faturasDoMes.length > 0 && (
          <section className="mb-5" aria-labelledby="titulo-faturas">
            <h2 id="titulo-faturas" className="mb-3 text-base font-bold">Faturas que vencem neste mês</h2>
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {doMes.faturasDoMes.map((f) => {
                const falta = Math.max(0, f.totalCentavos - f.pagoCentavos);
                const vencida = falta > 0 && compararDatas(f.data_vencimento, doMes.hoje) < 0;
                return (
                  <li key={f.id}>
                    <Link href={`/cartoes?id=${f.cartao_id}&fatura=${f.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${COR_ORIGEM.fatura}`}>
                        <Icon name="credit-card" size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{f.cartao_nome}</span>
                        <span className={`block text-xs ${vencida ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                          Vence {formatarDataCurta(f.data_vencimento)} ·{' '}
                          {falta === 0 ? ROTULO_STATUS_FATURA.paga : vencida ? `vencida, falta ${formatarCentavos(falta)}` : `falta ${formatarCentavos(falta)}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">−{formatarCentavos(f.totalCentavos)}</span>
                      <Icon name="chevron-right" size={16} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Despesas */}
        <section className="mb-6" aria-labelledby="titulo-despesas">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="titulo-despesas" className="text-base font-bold">Despesas do mês</h2>
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">{listaDespesas.length}</span>
          </div>
          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {renderLista(listaDespesas, 'despesa')}
          </div>
          {comprasNoCartao > 0 && (
            <p className="mt-2 px-1 text-xs text-slate-500 dark:text-slate-400">
              {comprasNoCartao === 1 ? 'A compra no cartão deste mês está' : `As ${comprasNoCartao} compras no cartão deste mês estão`} nas faturas acima.
            </p>
          )}
        </section>

        {/* Receitas */}
        <section className="mb-6" aria-labelledby="titulo-receitas">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="titulo-receitas" className="text-base font-bold">Receitas do mês</h2>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">{listaReceitas.length}</span>
          </div>
          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {renderLista(listaReceitas, 'receita')}
          </div>
        </section>
      </div>

      {operacoes.dialogo}
    </main>
  );
}
