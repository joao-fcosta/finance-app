'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Icon, { type IconName } from '@/app/components/Icon'
import Toast, { useToast } from '@/app/components/Toast'
import TransactionModal, { type ModoLancamento, type TransacaoEditavel } from '@/app/components/TransactionModal'
import { mesCorrente } from '@/app/lib/meses'
import type { TipoTransacao } from '@/app/lib/types'

/*
 * Estrutura comum das telas autenticadas: navegação inferior, botão de
 * lançamento rápido, formulário de lançamento e avisos (toast).
 *
 * As telas usam `useApp()` para abrir o formulário, mostrar avisos e
 * saber quando recarregar dados (`versaoDados` muda após qualquer
 * alteração feita em qualquer tela).
 */

export interface OpcoesLancamento {
  tipo?: TipoTransacao
  modo?: ModoLancamento
  transacao?: TransacaoEditavel | null
  totalParcelas?: number
  parcelasFuturasAfetadas?: number
  mes?: string
}

interface ContextoApp {
  mostrar: (texto: string, tipo?: 'sucesso' | 'erro') => void
  abrirLancamento: (opcoes?: OpcoesLancamento) => void
  /** Informa que dados mudaram; as telas recarregam. */
  notificarAlteracao: () => void
  versaoDados: number
  /** Mês visualizado no dashboard (padrão dos novos lançamentos). */
  mesSelecionado: string
  setMesSelecionado: (mes: string) => void
}

const Contexto = createContext<ContextoApp | null>(null)

export function useApp(): ContextoApp {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('useApp deve ser usado dentro de <AppShell>.')
  return contexto
}

interface ItemNavegacao {
  href: string
  rotulo: string
  icone: IconName
}

const NAVEGACAO: ItemNavegacao[] = [
  { href: '/', rotulo: 'Início', icone: 'wallet' },
  { href: '/recorrencias', rotulo: 'Recorrentes', icone: 'repeat' },
  { href: '/parcelamentos', rotulo: 'Parcelas', icone: 'layers' },
]

const OPCOES_RAPIDAS: { rotulo: string; detalhe: string; icone: IconName; opcoes: OpcoesLancamento; cor: string }[] = [
  {
    rotulo: 'Nova despesa',
    detalhe: 'Conta, compra ou parcelamento',
    icone: 'arrow-up-right',
    opcoes: { tipo: 'despesa', modo: 'unica' },
    cor: 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
  },
  {
    rotulo: 'Nova receita',
    detalhe: 'Salário, venda, reembolso',
    icone: 'arrow-down-left',
    opcoes: { tipo: 'receita', modo: 'unica' },
    cor: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400',
  },
  {
    rotulo: 'Nova recorrência',
    detalhe: 'Cadastre uma vez, repete sozinha',
    icone: 'repeat',
    opcoes: { tipo: 'despesa', modo: 'recorrente' },
    cor: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400',
  },
]

function MenuLancamento({ aberto, onFechar, onEscolher }: {
  aberto: boolean
  onFechar: () => void
  onEscolher: (opcoes: OpcoesLancamento) => void
}) {
  const primeiroRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!aberto) return
    primeiroRef.current?.focus()
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto, onFechar])

  if (!aberto) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onFechar()}
    >
      <div role="dialog" aria-modal="true" aria-label="Novo lançamento" className="w-full max-w-md rounded-t-3xl bg-white p-4 pb-[max(env(safe-area-inset-bottom),16px)] shadow-2xl dark:bg-slate-900 sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-base font-bold">Novo lançamento</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="space-y-1.5">
          {OPCOES_RAPIDAS.map((opcao, indice) => (
            <button
              key={opcao.rotulo}
              ref={indice === 0 ? primeiroRef : undefined}
              type="button"
              onClick={() => onEscolher(opcao.opcoes)}
              className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 active:scale-[0.99] dark:hover:bg-slate-800/70"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${opcao.cor}`}>
                <Icon name={opcao.icone} size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{opcao.rotulo}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{opcao.detalhe}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function BarraNavegacao({ onLancar }: { onLancar: () => void }) {
  const caminho = usePathname()
  const meio = Math.ceil(NAVEGACAO.length / 2)

  const item = ({ href, rotulo, icone }: ItemNavegacao) => {
    const ativo = href === '/' ? caminho === '/' : caminho.startsWith(href)
    return (
      <Link
        key={href}
        href={href}
        aria-current={ativo ? 'page' : undefined}
        className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
          ativo ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        <Icon name={icone} size={21} />
        <span className="truncate">{rotulo}</span>
      </Link>
    )
  }

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 px-3 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95"
    >
      <div className="mx-auto flex max-w-lg items-center gap-1">
        {NAVEGACAO.slice(0, meio).map(item)}
        <div className="flex flex-1 justify-center">
          <button
            type="button"
            onClick={onLancar}
            aria-label="Novo lançamento"
            className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 active:scale-95 dark:focus-visible:ring-offset-slate-950"
          >
            <Icon name="plus" size={26} />
          </button>
        </div>
        {NAVEGACAO.slice(meio).map(item)}
      </div>
    </nav>
  )
}

interface EstadoFormulario extends OpcoesLancamento {
  chave: number
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { toast, mostrar, fechar } = useToast()
  const [versaoDados, setVersaoDados] = useState(0)
  const [mesSelecionado, setMesSelecionado] = useState(() => mesCorrente())
  const [menuAberto, setMenuAberto] = useState(false)
  const [formulario, setFormulario] = useState<EstadoFormulario | null>(null)
  const contadorFormulario = useRef(0)

  const notificarAlteracao = useCallback(() => setVersaoDados((v) => v + 1), [])

  const abrirLancamento = useCallback((opcoes: OpcoesLancamento = {}) => {
    setMenuAberto(false)
    contadorFormulario.current += 1
    setFormulario({ ...opcoes, chave: contadorFormulario.current })
  }, [])

  const fecharMenu = useCallback(() => setMenuAberto(false), [])

  const valor = useMemo<ContextoApp>(
    () => ({ mostrar, abrirLancamento, notificarAlteracao, versaoDados, mesSelecionado, setMesSelecionado }),
    [mostrar, abrirLancamento, notificarAlteracao, versaoDados, mesSelecionado]
  )

  return (
    <Contexto.Provider value={valor}>
      <div className="min-h-screen bg-slate-50 pb-28 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {children}
      </div>

      <BarraNavegacao onLancar={() => setMenuAberto(true)} />
      <MenuLancamento aberto={menuAberto} onFechar={fecharMenu} onEscolher={abrirLancamento} />

      {formulario && (
        <TransactionModal
          key={formulario.chave}
          onClose={() => setFormulario(null)}
          onSalvo={(mensagem) => {
            setFormulario(null)
            mostrar(mensagem)
            notificarAlteracao()
          }}
          tipo={formulario.transacao?.tipo ?? formulario.tipo ?? 'despesa'}
          modoInicial={formulario.modo}
          mesAtual={formulario.mes ?? mesSelecionado}
          transacaoParaEditar={formulario.transacao ?? null}
          totalParcelas={formulario.totalParcelas}
          parcelasFuturasAfetadas={formulario.parcelasFuturasAfetadas}
        />
      )}

      <Toast toast={toast} onFechar={fechar} />
    </Contexto.Provider>
  )
}
