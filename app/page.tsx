'use client';

import { useEffect, useState } from 'react';
import TransactionModal from '@/app/components/TransactionModal';
import { buscarTransacoes, excluirTransacao } from '@/app/actions';

interface Transacao {
  id: string;
  nome: string;
  mes_referencia: string;
  valor_estimado: number;
  valor_real: number | null;
  tipo: 'receita' | 'despesa';
  categoria_id: number | null;
  parcelamento_id: string | null;
  numero_parcela: number | null;
  created_at: string;
}

type IconName =
  | 'wallet' | 'user' | 'trending-up' | 'trending-down'
  | 'arrow-down-left' | 'arrow-up-right' | 'chevron-left'
  | 'chevron-right' | 'receipt' | 'pencil' | 'trash' | 'plus';

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };

  switch (name) {
    case 'wallet':
      return <svg {...common}><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 9h18" /><path d="M16 14h2" /></svg>;
    case 'user':
      return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
    case 'trending-up':
      return <svg {...common}><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>;
    case 'trending-down':
      return <svg {...common}><path d="m3 7 6 6 4-4 8 8" /><path d="M15 17h6v-6" /></svg>;
    case 'arrow-down-left':
      return <svg {...common}><path d="M17 7 7 17" /><path d="M17 17H7V7" /></svg>;
    case 'arrow-up-right':
      return <svg {...common}><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>;
    case 'chevron-left':
      return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
    case 'chevron-right':
      return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
    case 'receipt':
      return <svg {...common}><path d="M5 3 7 4.5 9 3l3 1.5L15 3l2 1.5L19 3v18l-2-1.5-2 1.5-3-1.5L9 21l-2-1.5L5 21z" /><path d="M8.5 9h7M8.5 13h7M8.5 17h4" /></svg>;
    case 'pencil':
      return <svg {...common}><path d="m15 5 4 4" /><path d="M4 20l4.2-.8L19 8.4a2.1 2.1 0 0 0-3-3L5.2 16.2 4 20Z" /></svg>;
    case 'trash':
      return <svg {...common}><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 14h11l1-14M9 7V4h6v3" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  }
}

function CategoryProgress({
  title,
  value,
  percentage,
  color,
  formatarMoeda,
  larguraBarra,
}: {
  title: string;
  value: number;
  percentage: number;
  color: string;
  formatarMoeda: (value: number) => string;
  larguraBarra: (value: number) => number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums">{formatarMoeda(value)}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{percentage.toFixed(1)}% da receita</p>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${larguraBarra(percentage)}%` }} />
      </div>
    </div>
  );
}

interface Transacao {
  id: string;
  nome: string;
  mes_referencia: string;
  valor_estimado: number;
  valor_real: number | null;
  tipo: 'receita' | 'despesa';
  categoria_id: number | null;
  parcelamento_id: string | null;
  numero_parcela: number | null;
  created_at: string;
}

export default function Dashboard() {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] =
    useState<'receita' | 'despesa'>('receita');
  const [transacaoParaEditar, setTransacaoParaEditar] =
    useState<Transacao | null>(null)

  const [mesAtual, setMesAtual] = useState(() => {
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');

    return `${ano}-${mes}`;
  });

  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);

  /*
   * Busca as transações do mês atual.
   */
  useEffect(() => {
    const carregarTransacoes = async () => {
      setLoading(true);

      try {
        const dados = await buscarTransacoes(mesAtual);

        setTransacoes(dados as Transacao[]);
      } catch (error) {
        console.error(
          'Erro ao carregar transações:',
          error
        );

        alert(
          'Não foi possível carregar suas transações.'
        );
      } finally {
        setLoading(false);
      }
    };

    carregarTransacoes();
  }, [mesAtual]);


  /*
   * Abre o modal de receita/despesa.
   */
  const abrirModal = (
    tipo: 'receita' | 'despesa'
  ) => {
    setModalType(tipo);
    setModalOpen(true);
  };


  /*
   * Formata valores em reais.
   */
  const formatarMoeda = (valor: number) => {
    return valor.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };


  /*
   * Formata YYYY-MM para "setembro de 2026".
   */
  const formatarMes = (mes: string) => {
    const [ano, numeroMes] = mes.split('-');

    const data = new Date(
      Number(ano),
      Number(numeroMes) - 1
    );

    return data.toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    });
  };


  /*
   * Muda o mês atual.
   */
  const alterarMes = (direcao: number) => {
    const [ano, mes] = mesAtual
      .split('-')
      .map(Number);

    const data = new Date(
      ano,
      mes - 1 + direcao
    );

    const novoAno = data.getFullYear();

    const novoMes = String(
      data.getMonth() + 1
    ).padStart(2, '0');

    /*
     * IMPORTANTE:
     * sem espaços.
     *
     * 2026-09
     */
    setMesAtual(
      `${novoAno}-${novoMes}`
    );
  };


  /*
   * =====================================================
   * CÁLCULOS DO MÊS
   * =====================================================
   */

  const receitas = transacoes
    .filter(
      (transacao) =>
        transacao.tipo === 'receita'
    )
    .reduce(
      (total, transacao) =>
        total + Number(
          transacao.valor_real ??
          transacao.valor_estimado
        ),
      0
    );

  const despesas = transacoes
    .filter(
      (transacao) =>
        transacao.tipo === 'despesa'
    )
    .reduce(
      (total, transacao) =>
        total + Number(
          transacao.valor_real ??
          transacao.valor_estimado
        ),
      0
    );

  const saldo = receitas - despesas;


  /*
   * =====================================================
   * CATEGORIAS
   * =====================================================
   */

  const necessidades = transacoes
    .filter(
      (transacao) =>
        transacao.tipo === 'despesa' &&
        transacao.categoria_id === 1
    )
    .reduce(
      (total, transacao) =>
        total + Number(
          transacao.valor_real ??
          transacao.valor_estimado
        ),
      0
    );

  const estiloDeVida = transacoes
    .filter(
      (transacao) =>
        transacao.tipo === 'despesa' &&
        transacao.categoria_id === 2
    )
    .reduce(
      (total, transacao) =>
        total + Number(
          transacao.valor_real ??
          transacao.valor_estimado
        ),
      0
    );

  const projetos = transacoes
    .filter(
      (transacao) =>
        transacao.tipo === 'despesa' &&
        transacao.categoria_id === 3
    )
    .reduce(
      (total, transacao) =>
        total + Number(
          transacao.valor_real ??
          transacao.valor_estimado
        ),
      0
    );


  /*
   * Percentual de cada categoria sobre a receita.
   *
   * Exemplo:
   *
   * Receita = 3500
   * Necessidades = 700
   *
   * 700 / 3500 = 20%
   */
  const percentualNecessidades =
    receitas > 0
      ? (necessidades / receitas) * 100
      : 0;

  const percentualEstiloDeVida =
    receitas > 0
      ? (estiloDeVida / receitas) * 100
      : 0;

  const percentualProjetos =
    receitas > 0
      ? (projetos / receitas) * 100
      : 0;


  /*
   * Evita a barra ultrapassar 100%.
   */
  const larguraBarra = (percentual: number) =>
    Math.min(percentual, 100);


  /*
   * Nome da categoria.
   */
  const nomeCategoria = (
    categoriaId: number | null
  ) => {
    switch (categoriaId) {
      case 1:
        return 'Necessidades';

      case 2:
        return 'Estilo de Vida';

      case 3:
        return 'Projetos e Poupança';

      default:
        return null;
    }
  };
  const editar = (transacao: Transacao) => {
    setTransacaoParaEditar(transacao)
    setModalType(transacao.tipo)
    setModalOpen(true)
  }
  const excluir = async (id: string) => {
    const confirmar = window.confirm(
      'Deseja realmente excluir esta transação?'
    );

    if (!confirmar) {
      return;
    }

    try {
      await excluirTransacao(id);

      // Remove imediatamente da tela
      setTransacoes((transacoesAtuais) =>
        transacoesAtuais.filter(
          (transacao) => transacao.id !== id
        )
      );
    } catch (error) {
      console.error(
        'Erro ao excluir transação:',
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : 'Não foi possível excluir a transação.'
      );
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 pb-28 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto w-full max-w-lg px-4 pb-8 pt-5 sm:px-5">
        <header className="mb-6 flex items-center justify-between">
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
                {formatarMoeda(saldo)}
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
              {formatarMoeda(receitas)}
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
              {formatarMoeda(despesas)}
            </p>
          </div>
        </section>

        <section className="mb-5 flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => alterarMes(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Visualizando</p>
            <h2 className="mt-0.5 text-sm font-bold capitalize">{formatarMes(mesAtual)}</h2>
          </div>
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() => alterarMes(1)}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 active:scale-95 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Icon name="chevron-right" size={20} />
          </button>
        </section>

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
            <CategoryProgress
              title="Necessidades"
              value={necessidades}
              percentage={percentualNecessidades}
              color="bg-sky-500"
              formatarMoeda={formatarMoeda}
              larguraBarra={larguraBarra}
            />
            <CategoryProgress
              title="Estilo de vida"
              value={estiloDeVida}
              percentage={percentualEstiloDeVida}
              color="bg-violet-500"
              formatarMoeda={formatarMoeda}
              larguraBarra={larguraBarra}
            />
            <CategoryProgress
              title="Projetos e poupança"
              value={projetos}
              percentage={percentualProjetos}
              color="bg-emerald-500"
              formatarMoeda={formatarMoeda}
              larguraBarra={larguraBarra}
            />
          </div>
        </section>

        {/* Receitas */}
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                <Icon name="trending-up" size={18} />
              </span>
              <div>
                <h2 className="text-base font-bold">Receitas</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Entradas do mês</p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
              {transacoes.filter((transacao) => transacao.tipo === 'receita').length}
            </span>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {loading ? (
              <div className="px-5 py-6 text-center text-sm text-slate-500">Carregando receitas...</div>
            ) : transacoes.filter((transacao) => transacao.tipo === 'receita').length === 0 ? (
              <div className="px-5 py-7 text-center">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Nenhuma receita neste mês</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Suas entradas aparecerão aqui.</p>
              </div>
            ) : (
              transacoes.filter((transacao) => transacao.tipo === 'receita').map((transacao, index, lista) => (
                <div
                  key={transacao.id}
                  className={`flex items-center gap-3 px-4 py-4 ${index !== lista.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                    <Icon name="arrow-down-left" size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{transacao.nome}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {transacao.valor_real !== null ? 'Valor real' : 'Valor previsto'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <p className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                      +{formatarMoeda(Number(transacao.valor_real ?? transacao.valor_estimado))}
                    </p>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => editar(transacao)} aria-label={`Editar ${transacao.nome}`} title="Editar" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-slate-800 dark:hover:text-sky-400">
                        <Icon name="pencil" size={15} />
                      </button>
                      <button type="button" onClick={() => excluir(transacao.id)} aria-label={`Excluir ${transacao.nome}`} title="Excluir" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-800 dark:hover:text-rose-400">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Despesas */}
        <section className="mb-28">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                <Icon name="trending-down" size={18} />
              </span>
              <div>
                <h2 className="text-base font-bold">Despesas</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Saídas do mês</p>
              </div>
            </div>
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
              {transacoes.filter((transacao) => transacao.tipo === 'despesa').length}
            </span>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {loading ? (
              <div className="px-5 py-6 text-center text-sm text-slate-500">Carregando despesas...</div>
            ) : transacoes.filter((transacao) => transacao.tipo === 'despesa').length === 0 ? (
              <div className="px-5 py-7 text-center">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Nenhuma despesa neste mês</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Seus gastos aparecerão aqui.</p>
              </div>
            ) : (
              transacoes.filter((transacao) => transacao.tipo === 'despesa').map((transacao, index, lista) => (
                <div
                  key={transacao.id}
                  className={`flex items-center gap-3 px-4 py-4 ${index !== lista.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                    <Icon name="arrow-up-right" size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{transacao.nome}</p>
                    <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {nomeCategoria(transacao.categoria_id) || 'Despesa'}
                      {transacao.valor_real !== null ? ' · Valor real' : ' · Valor previsto'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <p className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      −{formatarMoeda(Number(transacao.valor_real ?? transacao.valor_estimado))}
                    </p>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => editar(transacao)} aria-label={`Editar ${transacao.nome}`} title="Editar" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-slate-800 dark:hover:text-sky-400">
                        <Icon name="pencil" size={15} />
                      </button>
                      <button type="button" onClick={() => excluir(transacao.id)} aria-label={`Excluir ${transacao.nome}`} title="Excluir" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-800 dark:hover:text-rose-400">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-lg gap-3">
          <button
            type="button"
            onClick={() => {
              setTransacaoParaEditar(null);
              setModalType('receita');
              setModalOpen(true);
            }}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
          >
            <Icon name="plus" size={18} />
            Nova receita
          </button>
          <button
            type="button"
            onClick={() => {
              setTransacaoParaEditar(null);
              setModalType('despesa');
              setModalOpen(true);
            }}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-rose-600 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.98]"
          >
            <Icon name="plus" size={18} />
            Nova despesa
          </button>
        </div>
      </div>

      <TransactionModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setTransacaoParaEditar(null);
        }}
        tipo={modalType}
        mesAtual={mesAtual}
        transacaoParaEditar={transacaoParaEditar}
      />
    </main>
  );
}
