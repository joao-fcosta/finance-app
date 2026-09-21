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

export default function Dashboard() {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] =
    useState<'receita' | 'despesa'>('receita');
  const [transacaoParaEditar, setTransacaoParaEditar] =
    useState<Transacao | null>(null)

  const [mesAtual, setMesAtual] = useState('2026-09');

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
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">

        {/* Header */}
        <header className="mb-8 flex items-center justify-between">

          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Finance
            </h1>

            <p className="text-sm text-slate-500 dark:text-slate-400">
              Sua vida financeira em ordem.
            </p>
          </div>

          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            U
          </button>

        </header>


        {/* Saldo */}
        <section className="mb-4 rounded-3xl bg-slate-900 p-6 text-white shadow-lg dark:bg-slate-800">

          <p className="text-sm font-medium text-slate-400">
            Saldo do mês
          </p>

          <h2 className="mt-2 text-3xl font-bold">
            {formatarMoeda(saldo)}
          </h2>

          <p className="mt-2 text-sm text-slate-400">
            {formatarMes(mesAtual)}
          </p>

        </section>


        {/* Receitas e despesas */}
        <section className="mb-8 grid grid-cols-2 gap-4">

          {/* Receitas */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">

            <div className="mb-3 flex items-center gap-2">

              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-950">
                ↑
              </span>

              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Receitas
              </span>

            </div>

            <p className="text-xl font-bold text-green-600">
              {formatarMoeda(receitas)}
            </p>

          </div>


          {/* Despesas */}
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">

            <div className="mb-3 flex items-center gap-2">

              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950">
                ↓
              </span>

              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Despesas
              </span>

            </div>

            <p className="text-xl font-bold text-red-600">
              {formatarMoeda(despesas)}
            </p>

          </div>

        </section>


        {/* Seletor de mês */}
        <section className="mb-6 flex items-center justify-between">

          <button
            type="button"
            onClick={() => alterarMes(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800 dark:hover:bg-slate-800"
          >
            ←
          </button>

          <h2 className="text-lg font-bold capitalize text-slate-900 dark:text-white">
            {formatarMes(mesAtual)}
          </h2>

          <button
            type="button"
            onClick={() => alterarMes(1)}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800 dark:hover:bg-slate-800"
          >
            →
          </button>

        </section>


        {/* 50/30/20 */}
        <section className="mb-8 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">

          <div className="mb-5">

            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Regra 50/30/20
            </h2>

            <p className="text-sm text-slate-500 dark:text-slate-400">
              Como suas despesas estão distribuídas.
            </p>

          </div>


          <div className="space-y-5">

            {/* Necessidades */}
            <div>

              <div className="mb-2 flex items-center justify-between text-sm">

                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Necessidades
                </span>

                <span className="text-slate-500 dark:text-slate-400">
                  {formatarMoeda(necessidades)} /{' '}
                  {percentualNecessidades.toFixed(1)}%
                </span>

              </div>

              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">

                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{
                    width: `${larguraBarra(
                      percentualNecessidades
                    )}%`,
                  }}
                />

              </div>

            </div>


            {/* Estilo de vida */}
            <div>

              <div className="mb-2 flex items-center justify-between text-sm">

                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Estilo de Vida
                </span>

                <span className="text-slate-500 dark:text-slate-400">
                  {formatarMoeda(estiloDeVida)} /{' '}
                  {percentualEstiloDeVida.toFixed(1)}%
                </span>

              </div>

              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">

                <div
                  className="h-full rounded-full bg-purple-500"
                  style={{
                    width: `${larguraBarra(
                      percentualEstiloDeVida
                    )}%`,
                  }}
                />

              </div>

            </div>


            {/* Projetos */}
            <div>

              <div className="mb-2 flex items-center justify-between text-sm">

                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Projetos e Poupança
                </span>

                <span className="text-slate-500 dark:text-slate-400">
                  {formatarMoeda(projetos)} /{' '}
                  {percentualProjetos.toFixed(1)}%
                </span>

              </div>

              <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">

                <div
                  className="h-full rounded-full bg-green-500"
                  style={{
                    width: `${larguraBarra(
                      percentualProjetos
                    )}%`,
                  }}
                />

              </div>

            </div>

          </div>

        </section>


        {/* Transações */}
        <section className="mb-28">

          <div className="mb-4 flex items-center justify-between">

            <div>

              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Transações
              </h2>

              <p className="text-sm text-slate-500 dark:text-slate-400">
                Movimentações de {formatarMes(mesAtual)}
              </p>

            </div>

          </div>


          <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">

            {loading ? (

              <div className="p-8 text-center text-sm text-slate-500">
                Carregando transações...
              </div>

            ) : transacoes.length === 0 ? (

              <div className="p-8 text-center">

                <p className="font-medium text-slate-700 dark:text-slate-300">
                  Nenhuma transação neste mês.
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  Adicione uma receita ou despesa para começar.
                </p>

              </div>

            ) : (

              transacoes.map((transacao, index) => (
                <div
                  key={transacao.id}
                  className={`flex items-center justify-between p-5 ${index !== transacoes.length - 1
                    ? 'border-b border-slate-100 dark:border-slate-800'
                    : ''
                    }`}
                >

                  <div className="flex min-w-0 items-center gap-3">

                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${transacao.tipo === 'receita'
                        ? 'bg-green-100 text-green-600 dark:bg-green-950'
                        : 'bg-red-100 text-red-600 dark:bg-red-950'
                        }`}
                    >
                      {transacao.tipo === 'receita'
                        ? '↑'
                        : '↓'}
                    </div>


                    <div className="min-w-0">

                      <p className="truncate font-semibold text-slate-900 dark:text-white">
                        {transacao.nome}
                      </p>

                      {transacao.tipo === 'despesa' &&
                        nomeCategoria(
                          transacao.categoria_id
                        ) && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {nomeCategoria(
                              transacao.categoria_id
                            )}
                          </p>
                        )}

                    </div>

                  </div>


                  <div className="ml-4 flex shrink-0 items-center gap-3">

                    <p
                      className={`font-bold ${transacao.tipo === 'receita'
                        ? 'text-green-600'
                        : 'text-red-600'
                        }`}
                    >
                      {transacao.tipo === 'receita'
                        ? '+'
                        : '-'}{' '}
                      {formatarMoeda(
                        Number(
                          transacao.valor_real ??
                          transacao.valor_estimado
                        )
                      )}
                    </p>

                    <button
                      onClick={() => editar(transacao)}
                      className="rounded-lg p-2 text-blue-500 transition hover:bg-blue-50 dark:hover:bg-slate-700"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        excluir(transacao.id)
                      }
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                      title="Excluir transação"
                    >
                      🗑
                    </button>

                  </div>

                </div>
              ))

            )}

          </div>

        </section>


        {/* Botões de ação */}
        <div className="fixed bottom-5 left-0 right-0 z-40 px-4">

          <div className="mx-auto flex max-w-5xl gap-3">

            <button
              type="button"
              onClick={() => {
                setTransacaoParaEditar(null)
                setModalType('receita')
                setModalOpen(true)
              }}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-green-600 text-base font-bold text-white shadow-lg transition hover:bg-green-700 active:scale-[0.98]"
            >
              <span className="text-xl">
                +
              </span>

              Receita
            </button>


            <button
              type="button"
              onClick={() => {
                setTransacaoParaEditar(null)
                setModalType('despesa')
                setModalOpen(true)
              }}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-red-600 text-base font-bold text-white shadow-lg transition hover:bg-red-700 active:scale-[0.98]"
            >
              <span className="text-xl">
                −
              </span>

              Despesa
            </button>

          </div>

        </div>

      </div>


      {/* Modal */}
      <TransactionModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setTransacaoParaEditar(null)
        }}
        tipo={modalType}
        mesAtual={mesAtual}
        transacaoParaEditar={transacaoParaEditar}
      />

    </main>
  );
}