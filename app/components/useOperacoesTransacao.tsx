'use client'

import { useCallback, useState, type ReactNode } from 'react'
import {
  definirPagamento,
  excluirParcela,
  excluirParcelamento,
  excluirTransacao,
  type Resultado,
} from '@/app/actions'
import ConfirmDialog, { type AcaoDialogo } from '@/app/components/ConfirmDialog'
import type { StatusPagamento } from '@/app/lib/types'

export interface AlvoOperacao {
  id: string
  nome: string
  parcelamento_id: string | null
  numero_parcela: number | null
  status_pagamento: StatusPagamento
  pago_em: string | null
}

interface OpcoesParcelamento {
  /** Quantidade total de parcelas e de parcelas pagas (para o aviso). */
  totalParcelas?: number
  parcelasPagas?: number
}

type Dialogo =
  | { tipo: 'excluir'; alvo: AlvoOperacao; opcoes: OpcoesParcelamento }
  | { tipo: 'excluir-parcelamento'; parcelamentoId: string; nome: string; opcoes: OpcoesParcelamento }
  | { tipo: 'desfazer-pagamento'; alvo: AlvoOperacao }

export function formatarDataPagamento(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Centraliza pagamento e exclusão de transações/parcelas, com os
 * diálogos de confirmação correspondentes.
 */
export function useOperacoesTransacao({
  onConcluido,
  mostrarMensagem,
}: {
  /** Chamado após uma operação bem-sucedida (para recarregar dados). */
  onConcluido: () => void
  mostrarMensagem: (texto: string, tipo?: 'sucesso' | 'erro') => void
}) {
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)
  const [processando, setProcessando] = useState(false)
  const [pagandoId, setPagandoId] = useState<string | null>(null)

  const fechar = useCallback(() => {
    if (!processando) setDialogo(null)
  }, [processando])

  const executar = useCallback(
    async (operacao: () => Promise<Resultado<unknown>>) => {
      setProcessando(true)
      try {
        const resultado = await operacao()

        if (resultado.ok) {
          mostrarMensagem(resultado.mensagem)
          setDialogo(null)
          onConcluido()
        } else {
          mostrarMensagem(resultado.erro, 'erro')
        }
      } catch (error) {
        console.error(error)
        mostrarMensagem('Não foi possível concluir a operação. Tente novamente.', 'erro')
      } finally {
        setProcessando(false)
      }
    },
    [mostrarMensagem, onConcluido]
  )

  const marcarComoPaga = useCallback(
    async (alvo: AlvoOperacao) => {
      setPagandoId(alvo.id)
      try {
        const resultado = await definirPagamento(alvo.id, true)
        if (resultado.ok) {
          mostrarMensagem(resultado.mensagem)
          onConcluido()
        } else {
          mostrarMensagem(resultado.erro, 'erro')
        }
      } catch (error) {
        console.error(error)
        mostrarMensagem('Não foi possível registrar o pagamento.', 'erro')
      } finally {
        setPagandoId(null)
      }
    },
    [mostrarMensagem, onConcluido]
  )

  /** Marca como paga direto; desfazer exige confirmação. */
  const alternarPagamento = useCallback(
    (alvo: AlvoOperacao) => {
      if (alvo.status_pagamento === 'pago') {
        setDialogo({ tipo: 'desfazer-pagamento', alvo })
      } else {
        void marcarComoPaga(alvo)
      }
    },
    [marcarComoPaga]
  )

  const solicitarExclusao = useCallback(
    (alvo: AlvoOperacao, opcoes: OpcoesParcelamento = {}) => {
      setDialogo({ tipo: 'excluir', alvo, opcoes })
    },
    []
  )

  const solicitarExclusaoParcelamento = useCallback(
    (parcelamentoId: string, nome: string, opcoes: OpcoesParcelamento = {}) => {
      setDialogo({ tipo: 'excluir-parcelamento', parcelamentoId, nome, opcoes })
    },
    []
  )

  let titulo = ''
  let descricao: ReactNode = null
  let acoes: AcaoDialogo[] = []

  if (dialogo?.tipo === 'desfazer-pagamento') {
    const { alvo } = dialogo
    titulo = 'Desfazer pagamento?'
    descricao = (
      <>
        <strong>{alvo.nome}</strong> voltará a ficar pendente
        {alvo.pago_em ? ` (paga em ${formatarDataPagamento(alvo.pago_em)})` : ''}. A data de pagamento registrada será removida.
      </>
    )
    acoes = [
      {
        label: 'Desfazer pagamento',
        variante: 'perigo',
        onClick: () => void executar(() => definirPagamento(alvo.id, false)),
      },
    ]
  }

  if (dialogo?.tipo === 'excluir') {
    const { alvo, opcoes } = dialogo
    const paga = alvo.status_pagamento === 'pago'

    if (alvo.parcelamento_id) {
      const parcelamentoId = alvo.parcelamento_id
      const pagas = opcoes.parcelasPagas

      titulo = 'Excluir parcela'
      descricao = (
        <>
          <strong>{alvo.nome}</strong> faz parte de um parcelamento. O que deseja excluir?
        </>
      )
      acoes = [
        {
          label: 'Somente esta parcela',
          detalhe: paga
            ? 'Indisponível: parcela paga. Desfaça o pagamento antes.'
            : 'As demais parcelas continuam como estão.',
          variante: 'neutra',
          desabilitada: paga,
          onClick: () => void executar(() => excluirParcela(alvo.id)),
        },
        {
          label: 'O parcelamento inteiro',
          detalhe:
            opcoes.totalParcelas !== undefined
              ? `Remove as ${opcoes.totalParcelas} parcelas${pagas ? `, incluindo ${pagas} ${pagas === 1 ? 'paga' : 'pagas'}` : ''}.`
              : 'Remove todas as parcelas, inclusive as pagas.',
          variante: 'perigo',
          onClick: () => void executar(() => excluirParcelamento(parcelamentoId)),
        },
      ]
    } else {
      titulo = 'Excluir transação?'
      descricao = (
        <>
          <strong>{alvo.nome}</strong> será excluída permanentemente.
        </>
      )
      acoes = [
        {
          label: 'Excluir',
          variante: 'perigo',
          onClick: () => void executar(() => excluirTransacao(alvo.id)),
        },
      ]
    }
  }

  if (dialogo?.tipo === 'excluir-parcelamento') {
    const { parcelamentoId, nome, opcoes } = dialogo
    const pagas = opcoes.parcelasPagas ?? 0

    titulo = 'Excluir parcelamento inteiro?'
    descricao = (
      <>
        <strong>{nome}</strong> e{' '}
        {opcoes.totalParcelas !== undefined ? `suas ${opcoes.totalParcelas} parcelas` : 'todas as suas parcelas'}{' '}
        serão excluídos permanentemente.
        {pagas > 0 && (
          <span className="mt-2 block font-semibold text-rose-600 dark:text-rose-400">
            {pagas} {pagas === 1 ? 'parcela já paga também será excluída' : 'parcelas já pagas também serão excluídas'}, junto com o histórico de pagamento.
          </span>
        )}
      </>
    )
    acoes = [
      {
        label: 'Excluir parcelamento',
        variante: 'perigo',
        onClick: () => void executar(() => excluirParcelamento(parcelamentoId)),
      },
    ]
  }

  const elemento = (
    <ConfirmDialog
      aberto={!!dialogo}
      titulo={titulo}
      descricao={descricao}
      acoes={acoes}
      onFechar={fechar}
      carregando={processando}
    />
  )

  return {
    alternarPagamento,
    solicitarExclusao,
    solicitarExclusaoParcelamento,
    pagandoId,
    dialogo: elemento,
  }
}
