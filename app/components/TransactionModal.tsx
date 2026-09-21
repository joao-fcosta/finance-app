'use client'

import { useState, FormEvent, useEffect } from 'react'
import {
  adicionarTransacao,
  atualizarTransacao,
} from '@/app/actions'

interface TransacaoParaEditar {
  id: string
  nome: string
  valor_estimado: number
  tipo: 'receita' | 'despesa'
  categoria_id: number | null
  mes_referencia: string
  parcelamento_id: string | null
}

interface TransactionModalProps {
  isOpen: boolean
  onClose: () => void
  tipo: 'receita' | 'despesa'
  mesAtual: string
  transacaoParaEditar?: TransacaoParaEditar | null
}

export default function TransactionModal({
  isOpen,
  onClose,
  tipo,
  mesAtual,
  transacaoParaEditar = null,
}: TransactionModalProps) {
  const [nome, setNome] = useState('')
  const [valor, setValor] = useState('')
  const [categoriaId, setCategoriaId] = useState(1)
  const [isInstallment, setIsInstallment] = useState(false)
  const [installments, setInstallments] = useState(2)
  const [mes, setMes] = useState(mesAtual)
  const [loading, setLoading] = useState(false)

  const modoEdicao = !!transacaoParaEditar

  /*
   * Preenche o formulário quando estamos editando.
   */
  useEffect(() => {
    if (transacaoParaEditar) {
      setNome(transacaoParaEditar.nome)

      setValor(
        String(
          transacaoParaEditar.valor_estimado
        ).replace('.', ',')
      )

      setCategoriaId(
        transacaoParaEditar.categoria_id ?? 1
      )

      setMes(
        transacaoParaEditar.mes_referencia
      )

      setIsInstallment(false)
      setInstallments(2)

      return
    }

    /*
     * Formulário novo.
     */
    setNome('')
    setValor('')
    setCategoriaId(1)
    setIsInstallment(false)
    setInstallments(2)
    setMes(mesAtual)
  }, [transacaoParaEditar, mesAtual, isOpen])

  if (!isOpen) {
    return null
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    setLoading(true)

    try {
      const valorNumerico = Number(
        valor.replace(',', '.')
      )

      if (!valorNumerico || valorNumerico <= 0) {
        throw new Error(
          'Informe um valor válido.'
        )
      }

      /*
       * =================================================
       * EDIÇÃO
       * =================================================
       */
      if (modoEdicao && transacaoParaEditar) {
        await atualizarTransacao({
          id: transacaoParaEditar.id,
          nome,
          valor: valorNumerico,
          mesReferencia: mes,
          categoriaId:
            tipo === 'despesa'
              ? categoriaId
              : undefined,
        })
      }

      /*
       * =================================================
       * NOVA TRANSAÇÃO
       * =================================================
       */
      else {
        await adicionarTransacao({
          nome,
          valor: valorNumerico,
          mesReferencia: mes,
          tipo,
          categoriaId:
            tipo === 'despesa'
              ? categoriaId
              : undefined,
          parcelas: isInstallment
            ? installments
            : 1,
        })
      }

      onClose()

      /*
       * Atualiza os dados exibidos.
       */
      window.location.reload()

    } catch (error) {
      console.error(error)

      alert(
        error instanceof Error
          ? error.message
          : 'Erro ao salvar a transação.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">

      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800">

        {/* Título */}
        <h3 className="mb-4 text-xl font-bold text-slate-900 dark:text-white">
          {modoEdicao
            ? 'Editar Transação'
            : `Nova ${
                tipo === 'receita'
                  ? 'Renda'
                  : 'Conta'
              }`}
        </h3>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* Nome */}
          <input
            type="text"
            required
            value={nome}
            onChange={(e) =>
              setNome(e.target.value)
            }
            placeholder="Nome (ex: Salário, Moto)"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />

          {/* Valor */}
          <input
            type="text"
            inputMode="decimal"
            required
            value={valor}
            onChange={(e) =>
              setValor(e.target.value)
            }
            placeholder="Valor (R$)"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />

          {/* Mês */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
              Mês de referência
            </label>

            <input
              type="month"
              required
              value={mes}
              onChange={(e) =>
                setMes(e.target.value)
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>

          {/* Categoria */}
          {tipo === 'despesa' && (
            <select
              value={categoriaId}
              onChange={(e) =>
                setCategoriaId(
                  Number(e.target.value)
                )
              }
              className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value={1}>
                Necessidades (50%)
              </option>

              <option value={2}>
                Estilo de Vida (30%)
              </option>

              <option value={3}>
                Projetos e Poupança (20%)
              </option>
            </select>
          )}

          {/* Parcelamento */}
          {tipo === 'despesa' &&
            !modoEdicao && (
              <div className="border-t border-slate-100 pt-3 dark:border-slate-700">

                <label className="flex items-center gap-3 text-slate-700 dark:text-slate-300">

                  <input
                    type="checkbox"
                    checked={isInstallment}
                    onChange={(e) =>
                      setIsInstallment(
                        e.target.checked
                      )
                    }
                    className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />

                  É uma compra parcelada?

                </label>

                {isInstallment && (
                  <div className="mt-3">

                    <input
                      type="number"
                      min="2"
                      max="120"
                      required
                      value={installments}
                      onChange={(e) =>
                        setInstallments(
                          Number(e.target.value)
                        )
                      }
                      placeholder="Quantidade de parcelas"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />

                    <p className="mt-2 text-xs text-slate-400">
                      O valor informado será o
                      valor total da compra.
                    </p>

                  </div>
                )}

              </div>
            )}

          {/* Botões */}
          <div className="flex gap-3 pt-4">

            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-xl bg-slate-200 p-3 font-bold text-slate-700 transition-transform active:scale-95 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-300"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-green-600 p-3 font-bold text-white transition-transform active:scale-95 disabled:opacity-50"
            >
              {loading
                ? 'Salvando...'
                : modoEdicao
                  ? 'Salvar alterações'
                  : 'Salvar'}
            </button>

          </div>

        </form>

      </div>

    </div>
  )
}