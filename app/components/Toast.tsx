'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'

export interface MensagemToast {
  id: number
  texto: string
  tipo: 'sucesso' | 'erro'
}

/** Estado de um toast simples, com fechamento automático. */
export function useToast() {
  const [toast, setToast] = useState<MensagemToast | null>(null)
  const contador = useRef(0)

  const mostrar = useCallback((texto: string, tipo: MensagemToast['tipo'] = 'sucesso') => {
    contador.current += 1
    setToast({ id: contador.current, texto, tipo })
  }, [])

  const fechar = useCallback(() => setToast(null), [])

  return { toast, mostrar, fechar }
}

export default function Toast({
  toast,
  onFechar,
}: {
  toast: MensagemToast | null
  onFechar: () => void
}) {
  useEffect(() => {
    if (!toast) return

    const tempo = window.setTimeout(onFechar, toast.tipo === 'erro' ? 6000 : 3500)
    return () => window.clearTimeout(tempo)
  }, [toast, onFechar])

  return (
    <div
      aria-live={toast?.tipo === 'erro' ? 'assertive' : 'polite'}
      role="status"
      className="pointer-events-none fixed inset-x-0 top-0 z-[120] flex justify-center px-4 pt-[max(env(safe-area-inset-top),16px)]"
    >
      {toast && (
        <div
          key={toast.id}
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${
            toast.tipo === 'erro' ? 'bg-rose-600' : 'bg-slate-900 dark:bg-emerald-700'
          }`}
        >
          <span className="mt-0.5 shrink-0">
            <Icon name={toast.tipo === 'erro' ? 'alert' : 'check'} size={18} />
          </span>
          <span className="flex-1">{toast.texto}</span>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar aviso"
            className="-m-1 shrink-0 rounded-lg p-1 opacity-80 hover:opacity-100"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
