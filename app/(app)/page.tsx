'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/app/components/AppShell';
import Icon from '@/app/components/Icon';
import { formatarDataPagamento, useOperacoesTransacao } from '@/app/components/useOperacoesTransacao';
import { buscarTransacoes } from '@/app/actions';
import { adicionarMeses, formatarMes, mesCorrente, normalizarMes } from '@/app/lib/meses';
import { formatarCentavos, reaisParaCentavos } from '@/app/lib/money';
import { situacaoParcela } from '@/app/lib/parcelamentos';
import BadgeSituacao from '@/app/components/BadgeSituacao';
import { formatarDataCurta } from '@/app/lib/datas';
import { nomeCategoria, type TipoTransacao, type Transacao } from '@/app/lib/types';

function CategoryProgress({
  title,
  valueCentavos,
  percentage,
  color,
}: {
  title: string;
  valueCentavos: number;
  percentage: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums">{formatarCentavos(valueCentavos)}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{percentage.toFixed(1)}% da receita</p>
        </div>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role="progressbar"
        aria-label={`${title}: ${percentage.toFixed(1)}% da receita`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(percentage, 100))}
      >
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(percentage, 100)}%` }} />
      </div>
    </div>
  );
}

/** Extrai o total de parcelas do sufixo "(3/12)" do nome (apenas exibição). */
function totalDoNome(nome: string): number | undefined {
  const correspondencia = nome.match(/\((\d+)\/(\d+)\)\s*$/);
  return correspondencia ? Number(correspondencia[2]) : undefined;
}

function valorCentavos(transacao: Transacao) {
  return reaisParaCentavos(Number(transacao.valor_real ?? transacao.valor_estimado));
}

function LinhaTransacao({
  transacao,
  ultima,
  mesHoje,
  pagando,
  onEditar,
  onExcluir,
  onPagamento,
}: {
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
  const situacao = ehParcela || ehRecorrente || paga ? situacaoParcela(transacao, mesHoje) : null;

  const detalhes = [
    receita ? null : nomeCategoria(transacao.categoria_id) || 'Despesa',
    ehRecorrente ? 'Recorrente' : null,
    transacao.data_vencimento ? `vence ${formatarDataCurta(transacao.data_vencimento)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`flex items-center gap-3 px-4 py-4 ${!ultima ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}>
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
          receita
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
            : 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
        }`}
      >
        <Icon name={ehParcela ? 'layers' : ehRecorrente ? 'repeat' : receita ? 'arrow-down-left' : 'arrow-up-right'} size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{transacao.nome}</p>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          {situacao && <BadgeSituacao situacao={situacao} />}
          <span className="truncate">
            {detalhes}
            {paga && transacao.pago_em ? ` · paga em ${formatarDataPagamento(transacao.pago_em)}` : ''}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <p className={`text-sm font-bold tabular-nums ${receita ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {receita ? '+' : '−'}{formatarCentavos(valorCentavos(transacao))}
        </p>
        <div className="flex items-center gap-1">
          {!receita && (
            <button
              type="button"
              onClick={onPagamento}
              disabled={pagando}
              aria-pressed={paga}
              aria-label={paga ? `Desfazer pagamento de ${transacao.nome}` : `Marcar ${transacao.nome} como paga`}
              title={paga ? 'Desfazer pagamento' : 'Marcar como paga'}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition disabled:opacity-50 ${
                paga
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-400'
                  : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-800 dark:hover:text-emerald-400'
              }`}
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

export default function Dashboard() {
  const app = useApp();
  const { mostrar, versaoDados, notificarAlteracao, setMesSelecionado } = app;
  const [mesAtual, setMesAtual] = useState(() => app.mesSelecionado);
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const seletorMesRef = useRef<HTMLInputElement>(null);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  const operacoes = useOperacoesTransacao({ onConcluido: notificarAlteracao, mostrarMensagem: mostrar });

  const mesHoje = mesCorrente();

  /*
   * Busca as transações do mês selecionado.
   */
  useEffect(() => {
    let cancelado = false;

    buscarTransacoes(mesAtual)
      .then((dados) => {
        if (cancelado) return;
        setTransacoes(dados);
        setErroCarregamento(null);
      })
      .catch((error) => {
        if (cancelado) return;
        console.error('Erro ao carregar transações:', error);
        setErroCarregamento('Não foi possível carregar suas transações.');
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

  const abrirModal = (tipo: TipoTransacao, transacao: Transacao) => {
    app.abrirLancamento({
      tipo,
      transacao,
      totalParcelas: transacao.parcelamento_id ? totalDoNome(transacao.nome) : undefined,
    });
  };

  /*
   * =====================================================
   * CÁLCULOS DO MÊS (em centavos)
   * =====================================================
   */
  const somar = (filtro: (t: Transacao) => boolean) =>
    transacoes.filter(filtro).reduce((total, t) => total + valorCentavos(t), 0);

  const receitas = somar((t) => t.tipo === 'receita');
  const despesas = somar((t) => t.tipo === 'despesa');
  const saldo = receitas - despesas;

  const necessidades = somar((t) => t.tipo === 'despesa' && t.categoria_id === 1);
  const estiloDeVida = somar((t) => t.tipo === 'despesa' && t.categoria_id === 2);
  const projetos = somar((t) => t.tipo === 'despesa' && t.categoria_id === 3);

  const percentual = (valor: number) => (receitas > 0 ? (valor / receitas) * 100 : 0);

  const listaReceitas = transacoes.filter((t) => t.tipo === 'receita');
  const listaDespesas = transacoes.filter((t) => t.tipo === 'despesa');

  const parcelasDoMes = listaDespesas.filter((t) => t.parcelamento_id);
  const parcelasEmAberto = parcelasDoMes.filter((t) => t.status_pagamento !== 'pago').length;

  const mesAnterior = adicionarMeses(mesAtual, -1);
  const proximoMes = adicionarMeses(mesAtual, 1);

  const renderLista = (lista: Transacao[], tipo: TipoTransacao) => {
    const rotulo = tipo === 'receita' ? 'receitas' : 'despesas';

    if (loading) {
      return <div className="px-5 py-6 text-center text-sm text-slate-500" role="status">Carregando {rotulo}...</div>;
    }

    if (erroCarregamento) {
      return (
        <div className="px-5 py-6 text-center">
          <p className="text-sm text-rose-600 dark:text-rose-400">{erroCarregamento}</p>
          <button type="button" onClick={() => { setLoading(true); recarregar(); }} className="mt-2 text-sm font-bold text-emerald-700 underline dark:text-emerald-400">
            Tentar novamente
          </button>
        </div>
      );
    }

    if (lista.length === 0) {
      return (
        <div className="px-5 py-7 text-center">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Nenhuma {tipo} neste mês</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {tipo === 'receita' ? 'Suas entradas aparecerão aqui.' : 'Seus gastos aparecerão aqui.'}
          </p>
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
        onEditar={() => abrirModal(transacao.tipo, transacao)}
        onExcluir={() => operacoes.solicitarExclusao(transacao, { totalParcelas: totalDoNome(transacao.nome) })}
        onPagamento={() => operacoes.alternarPagamento(transacao)}
      />
    ));
  };

  return (
    <main>
      <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-5 sm:px-5">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                <Icon name="wallet" size={19} />
              </span>
              <h1 className="text-xl font-extrabold tracking-tight">Finance</h1>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Sua vida financeira em ordem.
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            <Icon name="user" size={18} />
          </div>
        </header>

        <section className="mb-4 overflow-hidden rounded-[28px] bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-500 p-5 text-white shadow-lg shadow-emerald-900/10">
          <div className="flex items-start justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-50/90">
                <Icon name="wallet" size={16} />
                Saldo do mês
              </p>
              <h2 className="mt-3 break-words text-3xl font-bold tracking-tight">
                {formatarCentavos(saldo)}
              </h2>
              <p className="mt-2 text-sm capitalize text-emerald-50/80">
                {formatarMes(mesAtual)}
              </p>
            </div>
            <div className="rounded-2xl bg-white/15 p-3">
              <Icon name={saldo >= 0 ? 'trending-up' : 'trending-down'} size={24} />
            </div>
          </div>
        </section>

        <section className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                <Icon name="arrow-down-left" size={18} />
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Receitas</span>
            </div>
            <p className="break-words text-lg font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
              {formatarCentavos(receitas)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                <Icon name="arrow-up-right" size={18} />
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Despesas</span>
            </div>
            <p className="break-words text-lg font-bold tracking-tight text-rose-600 dark:text-rose-400">
              {formatarCentavos(despesas)}
            </p>
          </div>
        </section>

        {/* Navegação mensal */}
        <nav aria-label="Navegação mensal" className="mb-5 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label={`Mês anterior: ${formatarMes(mesAnterior)}`}
              onClick={() => irParaMes(mesAnterior)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Icon name="chevron-left" size={20} />
            </button>

            <div className="relative min-w-0 flex-1 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Visualizando</p>
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
                className="mx-auto mt-0.5 flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-sm font-bold capitalize transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-slate-800"
                aria-label={`Escolher mês. Mês selecionado: ${formatarMes(mesAtual)}`}
              >
                <span aria-live="polite">{formatarMes(mesAtual)}</span>
                <Icon name="calendar" size={14} />
              </button>
              <input
                ref={seletorMesRef}
                type="month"
                value={mesAtual}
                onChange={(e) => {
                  const mes = normalizarMes(e.target.value);
                  if (mes) irParaMes(mes);
                }}
                tabIndex={-1}
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-0 w-full opacity-0"
              />
            </div>

            <button
              type="button"
              aria-label={`Próximo mês: ${formatarMes(proximoMes)}`}
              onClick={() => irParaMes(proximoMes)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Icon name="chevron-right" size={20} />
            </button>
          </div>

          {mesAtual !== mesHoje && (
            <div className="mt-1 flex justify-center pb-1">
              <button
                type="button"
                onClick={() => irParaMes(mesHoje)}
                className="rounded-lg px-2.5 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
              >
                Voltar para o mês atual
              </button>
            </div>
          )}
        </nav>

        {/* Atalho: parcelas do mês */}
        {!loading && parcelasDoMes.length > 0 && (
          <Link
            href="/parcelamentos"
            className="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400">
              <Icon name="layers" size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">
                {parcelasDoMes.length} {parcelasDoMes.length === 1 ? 'parcela' : 'parcelas'} neste mês
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {parcelasEmAberto === 0
                  ? 'Todas pagas'
                  : `${parcelasEmAberto} em aberto · gerenciar parcelamentos`}
              </span>
            </span>
            <Icon name="chevron-right" size={18} />
          </Link>
        )}

        <section className="mb-6 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold">Distribuição das despesas</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Acompanhe como seus gastos se dividem em relação às receitas.
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">50 / 30 / 20</span>
          </div>

          <div className="space-y-5">
            <CategoryProgress title="Necessidades" valueCentavos={necessidades} percentage={percentual(necessidades)} color="bg-sky-500" />
            <CategoryProgress title="Estilo de vida" valueCentavos={estiloDeVida} percentage={percentual(estiloDeVida)} color="bg-violet-500" />
            <CategoryProgress title="Projetos e poupança" valueCentavos={projetos} percentage={percentual(projetos)} color="bg-emerald-500" />
          </div>
        </section>

        {/* Receitas */}
        <section className="mb-6" aria-labelledby="titulo-receitas">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                <Icon name="trending-up" size={18} />
              </span>
              <div>
                <h2 id="titulo-receitas" className="text-base font-bold">Receitas</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Entradas do mês</p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
              {listaReceitas.length}
            </span>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {renderLista(listaReceitas, 'receita')}
          </div>
        </section>

        {/* Despesas */}
        <section className="mb-28" aria-labelledby="titulo-despesas">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                <Icon name="trending-down" size={18} />
              </span>
              <div>
                <h2 id="titulo-despesas" className="text-base font-bold">Despesas</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Saídas do mês</p>
              </div>
            </div>
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
              {listaDespesas.length}
            </span>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {renderLista(listaDespesas, 'despesa')}
          </div>
        </section>
      </div>

      {operacoes.dialogo}
    </main>
  );
}
