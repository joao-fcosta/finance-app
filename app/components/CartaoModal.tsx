'use client'

import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { criarCartao, editarCartao } from '@/app/actions'
import Icon from '@/app/components/Icon'
import { cicloDaCompra } from '@/app/lib/cartoes'
import { formatarData, formatarDataCurta, hoje } from '@/app/lib/datas'
import { centavosParaTextoCampo, reaisParaCentavos, textoParaCentavos } from '@/app/lib/money'
import type { Cartao } from '@/app/lib/types'

const classeCampo =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white'

const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard']

function campoDia(texto: string) {
  return texto.replace(/\D/g, '').slice(0, 2)
}

export default function CartaoModal({
  cartao,
  onClose,
  onSalvo,
}: {
  /** null = novo cartão. */
  cartao: Cartao | null
  onClose: () => void
  onSalvo: (mensagem: string) => void
}) {
  const [nome, setNome] = useState(cartao?.nome ?? '')
  const [bandeira, setBandeira] = useState(cartao?.bandeira ?? '')
  const [limiteCentavos, setLimiteCentavos] = useState(() => (cartao ? reaisParaCentavos(Number(cartao.limite)) : 0))
  const [fechamento, setFechamento] = useState(cartao ? String(cartao.dia_fechamento) : '')
  const [vencimento, setVencimento] = useState(cartao ? String(cartao.dia_vencimento) : '')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const tituloId = useId()
  const nomeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nomeRef.current?.focus()
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && !salvando && onClose()
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onClose, salvando])

  const diaF = Number(fechamento)
  const diaV = Number(vencimento)
  const diasValidos = diaF >= 1 && diaF <= 31 && diaV >= 1 && diaV <= 31
  const previa = diasValidos ? cicloDaCompra({ dia_fechamento: diaF, dia_vencimento: diaV }, hoje()) : null

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (salvando) return
    if (!nome.trim()) return setErro('Informe o nome do cartão.')
    if (!diasValidos) return setErro('Os dias de fechamento e vencimento devem ser entre 1 e 31.')

    setSalvando(true)
    setErro(null)
    try {
      const dados = { nome, bandeira: bandeira || null, limiteCentavos, diaFechamento: diaF, diaVencimento: diaV }
      const resultado = cartao ? await editarCartao(cartao.id, { ...dados, ativo: cartao.ativo }) : await criarCartao(dados)
      if (resultado.ok) onSalvo(resultado.mensagem)
      else setErro(resultado.erro)
    } catch (error) {
      console.error(error)
      setErro('Não foi possível salvar. Verifique sua conexão e tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !salvando && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={tituloId} className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h3 id={tituloId} className="text-lg font-bold">{cartao ? 'Editar cartão' : 'Novo cartão'}</h3>
          <button type="button" onClick={onClose} disabled={salvando} aria-label="Fechar" className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">
            <Icon name="x" size={20} />
          </button>
        </div>

        <form onSubmit={enviar} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {erro && (
              <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <span className="mt-0.5 shrink-0"><Icon name="alert" size={16} /></span>
                <span>{erro}</span>
              </div>
            )}

            <div>
              <label htmlFor="cartao-nome" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Nome do cartão</label>
              <input ref={nomeRef} id="cartao-nome" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Nubank, Inter" autoComplete="off" className={classeCampo} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="cartao-fechamento" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Fecha dia</label>
                <input id="cartao-fechamento" inputMode="numeric" pattern="[0-9]*" value={fechamento} onChange={(e) => setFechamento(campoDia(e.target.value))} placeholder="25" className={`${classeCampo} text-center text-lg font-bold`} />
              </div>
              <div>
                <label htmlFor="cartao-vencimento" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Vence dia</label>
                <input id="cartao-vencimento" inputMode="numeric" pattern="[0-9]*" value={vencimento} onChange={(e) => setVencimento(campoDia(e.target.value))} placeholder="5" className={`${classeCampo} text-center text-lg font-bold`} />
              </div>
            </div>

            {previa && (
              <p aria-live="polite" className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                Uma compra hoje entra na fatura que fecha em <strong>{formatarDataCurta(previa.data_fechamento)}</strong> e vence em{' '}
                <strong>{formatarData(previa.data_vencimento)}</strong>.
              </p>
            )}

            <div>
              <label htmlFor="cartao-limite" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Limite total</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-slate-400">R$</span>
                <input id="cartao-limite" inputMode="numeric" autoComplete="off" value={centavosParaTextoCampo(limiteCentavos)} onChange={(e) => setLimiteCentavos(textoParaCentavos(e.target.value))} placeholder="0,00" className={`${classeCampo} pl-12 text-right text-lg font-bold tabular-nums`} />
              </div>
            </div>

            <fieldset>
              <legend className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Bandeira <span className="font-normal text-slate-400">(opcional)</span>
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {BANDEIRAS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={bandeira === b}
                    onClick={() => setBandeira(bandeira === b ? '' : b)}
                    className={`h-9 rounded-xl border px-3 text-xs font-bold transition ${
                      bandeira === b ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </fieldset>

            {cartao && (
              <p className="rounded-2xl bg-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Mudar os dias atualiza as faturas que ainda não fecharam. Faturas fechadas e as compras já lançadas não mudam.
              </p>
            )}
          </div>

          <div className="flex gap-3 border-t border-slate-100 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 dark:border-slate-800">
            <button type="button" onClick={onClose} disabled={salvando} className="h-12 flex-1 rounded-2xl bg-slate-100 text-sm font-bold text-slate-700 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={salvando} className="flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-sky-600 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60">
              {salvando && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {salvando ? 'Salvando...' : cartao ? 'Salvar alterações' : 'Cadastrar cartão'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
