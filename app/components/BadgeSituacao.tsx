import type { SituacaoParcela } from '@/app/lib/parcelamentos'

const ROTULO_SITUACAO: Record<SituacaoParcela, { texto: string; classe: string }> = {
  paga: { texto: 'Paga', classe: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' },
  pendente: { texto: 'Pendente', classe: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  vencida: { texto: 'Vencida', classe: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400' },
  sem_status: { texto: 'Sem status', classe: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
}

export default function BadgeSituacao({ situacao }: { situacao: SituacaoParcela }) {
  const { texto, classe } = ROTULO_SITUACAO[situacao]

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${classe}`}
      title={situacao === 'sem_status' ? 'Registro anterior ao controle de pagamento' : undefined}
    >
      {texto}
    </span>
  )
}
