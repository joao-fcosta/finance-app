'use client'

import { FormEvent, useEffect, useId, useRef, useState } from 'react'
import { editarRecorrencia } from '@/app/actions'
import Icon from '@/app/components/Icon'
import { dataValida, formatarData } from '@/app/lib/datas'
import { centavosParaTextoCampo, reaisParaCentavos, textoParaCentavos } from '@/app/lib/money'
import { descreverFrequencia } from '@/app/lib/recorrencias'
import { CATEGORIAS, type Recorrencia } from '@/app/lib/types'

const classeCampo =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-white'

/**
 * Edição de uma recorrência: nome, valor, categoria e data final.
 * Frequência e início não mudam (para isso, encerre e crie outra), o que
 * mantém o histórico e as próximas datas previsíveis.
 */
export default function RecorrenciaModal({
  recorrencia,
  onClose,
  onSalvo,
}: {
  recorrencia: Recorrencia
  onClose: () => void
  onSalvo: (mensagem: string) => void
}) {
  const [nome, setNome] = useState(recorrencia.nome)
  const [valorCentavos, setValorCentavos] = useState(() => reaisParaCentavos(Number(recorrencia.valor)))
  const [categoriaId, setCategoriaId] = useState(recorrencia.categoria_id ?? 1)
  const [temFim, setTemFim] = useState(!!recorrencia.data_fim)
  const [dataFim, setDataFim] = useState(recorrencia.data_fim ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const tituloId = useId()
  const nomeRef = useRef<HTMLInputElement>(null)
  const ehDespesa = recorrencia.tipo === 'despesa'

  useEffect(() => {
    nomeRef.current?.focus()
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && !salvando && onClose()
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onClose, salvando])

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (salvando) return

    if (!nome.trim()) return setErro('Informe um nome.')
    if (valorCentavos <= 0) return setErro('Informe um valor maior que zero.')
    if (temFim && !dataValida(dataFim)) return setErro('Escolha a data final.')
    if (temFim && dataFim < recorrencia.data_inicio) {
      return setErro(`A data final deve ser a partir de ${formatarData(recorrencia.data_inicio)}.`)
    }

    setSalvando(true)
    setErro(null)
    try {
      const resultado = await editarRecorrencia({
        id: recorrencia.id,
        nome,
        valorCentavos,
        categoriaId: ehDespesa ? categoriaId : undefined,
        dataFim: temFim ? dataFim : null,
      })
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
          <div className="min-w-0">
            <h3 id={tituloId} className="text-lg font-bold">Editar recorrência</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{descreverFrequencia(recorrencia)}</p>
          </div>
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
              <label htmlFor="rec-nome" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Nome</label>
              <input ref={nomeRef} id="rec-nome" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} autoComplete="off" className={classeCampo} />
            </div>

            <div>
              <label htmlFor="rec-valor" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Valor</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-slate-400">R$</span>
                <input
                  id="rec-valor"
                  inputMode="numeric"
                  autoComplete="off"
                  value={centavosParaTextoCampo(valorCentavos)}
                  onChange={(e) => setValorCentavos(textoParaCentavos(e.target.value))}
                  placeholder="0,00"
                  className={`${classeCampo} pl-12 text-right text-lg font-bold tabular-nums`}
                />
              </div>
            </div>

            {ehDespesa && (
              <fieldset>
                <legend className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Categoria</legend>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORIAS.map((c) => (
                    <label
                      key={c.id}
                      className={`flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border px-2 text-center text-xs font-bold leading-tight transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500 ${
                        categoriaId === c.id
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <input type="radio" name="rec-categoria" checked={categoriaId === c.id} onChange={() => setCategoriaId(c.id)} className="sr-only" />
                      {c.nome}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div>
              <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={temFim} onChange={(e) => setTemFim(e.target.checked)} className="h-5 w-5 accent-emerald-600" />
                Tem data para terminar
              </label>
              {temFim && (
                <input type="date" value={dataFim} min={recorrencia.data_inicio} onChange={(e) => setDataFim(e.target.value)} aria-label="Data final" className={`${classeCampo} mt-2`} />
              )}
            </div>

            <p className="rounded-2xl bg-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              As alterações valem para as próximas ocorrências pendentes. Ocorrências passadas, pagas
              ou editadas individualmente não mudam.
            </p>
          </div>

          <div className="flex gap-3 border-t border-slate-100 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 dark:border-slate-800">
            <button type="button" onClick={onClose} disabled={salvando} className="h-12 flex-1 rounded-2xl bg-slate-100 text-sm font-bold text-slate-700 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={salvando} className="flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
              {salvando && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {salvando ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
