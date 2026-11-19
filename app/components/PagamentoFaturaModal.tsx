'use client'

import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { pagarFatura } from '@/app/actions'
import Icon from '@/app/components/Icon'
import { dataValida, hoje } from '@/app/lib/datas'
import { centavosParaTextoCampo, formatarCentavos, textoParaCentavos } from '@/app/lib/money'

/**
 * Registro de pagamento de fatura (total ou parcial). O pagamento liquida
 * a fatura: não é uma nova despesa (as compras já são as despesas).
 */
export default function PagamentoFaturaModal({
  faturaId,
  titulo,
  restanteCentavos,
  onClose,
  onSalvo,
}: {
  faturaId: string
  titulo: string
  restanteCentavos: number
  onClose: () => void
  onSalvo: (mensagem: string) => void
}) {
  const [valorCentavos, setValorCentavos] = useState(restanteCentavos)
  const [data, setData] = useState(() => hoje())
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const tituloId = useId()
  const valorRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    valorRef.current?.focus()
    valorRef.current?.select()
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && !salvando && onClose()
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onClose, salvando])

  const parcial = valorCentavos > 0 && valorCentavos < restanteCentavos

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (salvando) return
    if (valorCentavos <= 0) return setErro('Informe o valor pago.')
    if (valorCentavos > restanteCentavos) return setErro(`O valor máximo é ${formatarCentavos(restanteCentavos)}.`)
    if (!dataValida(data)) return setErro('Informe a data do pagamento.')

    setSalvando(true)
    setErro(null)
    try {
      const resultado = await pagarFatura(faturaId, valorCentavos, data)
      if (resultado.ok) onSalvo(resultado.mensagem)
      else setErro(resultado.erro)
    } catch (error) {
      console.error(error)
      setErro('Não foi possível registrar. Verifique sua conexão e tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !salvando && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={tituloId} className="w-full max-w-md rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h3 id={tituloId} className="text-lg font-bold">Pagar fatura</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{titulo}</p>
          </div>
          <button type="button" onClick={onClose} disabled={salvando} aria-label="Fechar" className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">
            <Icon name="x" size={20} />
          </button>
        </div>

        <form onSubmit={enviar} noValidate>
          <div className="space-y-4 px-5 py-4">
            {erro && (
              <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <span className="mt-0.5 shrink-0"><Icon name="alert" size={16} /></span>
                <span>{erro}</span>
              </div>
            )}

            <div>
              <label htmlFor="pagamento-valor" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Valor pago</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-slate-400">R$</span>
                <input
                  ref={valorRef}
                  id="pagamento-valor"
                  inputMode="numeric"
                  autoComplete="off"
                  value={centavosParaTextoCampo(valorCentavos)}
                  onChange={(e) => setValorCentavos(Math.min(textoParaCentavos(e.target.value), restanteCentavos))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-12 pr-4 text-right text-lg font-bold tabular-nums outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Saldo da fatura: {formatarCentavos(restanteCentavos)}</span>
                {valorCentavos !== restanteCentavos && (
                  <button type="button" onClick={() => setValorCentavos(restanteCentavos)} className="font-bold text-emerald-700 underline dark:text-emerald-400">
                    Pagar tudo
                  </button>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="pagamento-data" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Data do pagamento</label>
              <input id="pagamento-data" type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-950" />
            </div>

            <p className="rounded-2xl bg-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {parcial
                ? `Pagamento parcial: ficam ${formatarCentavos(restanteCentavos - valorCentavos)} em aberto nesta fatura. `
                : ''}
              O pagamento quita a fatura e libera o limite. Ele não conta como nova despesa: as compras já são as despesas.
            </p>
          </div>

          <div className="flex gap-3 border-t border-slate-100 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 dark:border-slate-800">
            <button type="button" onClick={onClose} disabled={salvando} className="h-12 flex-1 rounded-2xl bg-slate-100 text-sm font-bold text-slate-700 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={salvando} className="flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
              {salvando && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {salvando ? 'Registrando...' : parcial ? 'Registrar pagamento parcial' : 'Registrar pagamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
