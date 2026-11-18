'use client'

import { ReactNode, useEffect, useId, useRef } from 'react'

export interface AcaoDialogo {
  label: string
  /** Texto auxiliar exibido abaixo do rótulo do botão. */
  detalhe?: string
  variante?: 'perigo' | 'primaria' | 'neutra'
  onClick: () => void
  desabilitada?: boolean
}

interface ConfirmDialogProps {
  aberto: boolean
  titulo: string
  descricao?: ReactNode
  acoes: AcaoDialogo[]
  onFechar: () => void
  carregando?: boolean
  rotuloCancelar?: string
}

const estilos = {
  perigo: 'bg-rose-600 text-white hover:bg-rose-700',
  primaria: 'bg-emerald-600 text-white hover:bg-emerald-700',
  neutra:
    'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
}

/**
 * Diálogo de confirmação acessível. Substitui window.confirm para
 * permitir mais de uma ação explícita (ex.: "somente esta parcela" ou
 * "parcelamento inteiro").
 */
export default function ConfirmDialog({
  aberto,
  titulo,
  descricao,
  acoes,
  onFechar,
  carregando = false,
  rotuloCancelar = 'Cancelar',
}: ConfirmDialogProps) {
  const tituloId = useId()
  const descricaoId = useId()
  const cancelarRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!aberto) return

    // Foco inicial no botão seguro (cancelar).
    cancelarRef.current?.focus()

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape' && !carregando) onFechar()
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto, carregando, onFechar])

  if (!aberto) return null

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget && !carregando) onFechar()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={descricao ? descricaoId : undefined}
        className="w-full max-w-sm rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),20px)] shadow-2xl dark:bg-slate-900 sm:rounded-3xl sm:pb-5"
      >
        <h3 id={tituloId} className="text-lg font-bold text-slate-900 dark:text-white">
          {titulo}
        </h3>

        {descricao && (
          <div id={descricaoId} className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {descricao}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {acoes.map((acao) => (
            <button
              key={acao.label}
              type="button"
              onClick={acao.onClick}
              disabled={carregando || acao.desabilitada}
              className={`min-h-12 w-full rounded-2xl px-4 py-2.5 text-left text-sm font-bold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${estilos[acao.variante ?? 'neutra']}`}
            >
              <span className="block">{acao.label}</span>
              {acao.detalhe && (
                <span className="mt-0.5 block text-xs font-medium opacity-80">{acao.detalhe}</span>
              )}
            </button>
          ))}

          <button
            ref={cancelarRef}
            type="button"
            onClick={onFechar}
            disabled={carregando}
            className="min-h-12 w-full rounded-2xl px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {carregando ? 'Processando...' : rotuloCancelar}
          </button>
        </div>
      </div>
    </div>
  )
}
