'use client'

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { adicionarTransacao, atualizarTransacao } from '@/app/actions'
import Icon from '@/app/components/Icon'
import { adicionarMeses, formatarMesCurto, normalizarMes } from '@/app/lib/meses'
import {
  centavosParaTextoCampo,
  distribuirParcelas,
  formatarCentavos,
  reaisParaCentavos,
  textoParaCentavos,
} from '@/app/lib/money'
import {
  CATEGORIAS,
  EscopoEdicao,
  StatusPagamento,
  TipoTransacao,
  nomeBaseParcela,
} from '@/app/lib/types'

export interface TransacaoEditavel {
  id: string
  nome: string
  valor_estimado: number
  tipo: TipoTransacao
  categoria_id: number | null
  mes_referencia: string
  parcelamento_id: string | null
  numero_parcela: number | null
  status_pagamento: StatusPagamento
}

interface TransactionModalProps {
  onClose: () => void
  /** Chamado após salvar com sucesso, com a mensagem de confirmação. */
  onSalvo: (mensagem: string) => void
  tipo: TipoTransacao
  mesAtual: string
  transacaoParaEditar?: TransacaoEditavel | null
  /** Total de parcelas do parcelamento (apenas para exibição). */
  totalParcelas?: number
  /** Quantas parcelas "esta e as próximas" afetaria (quando conhecido). */
  parcelasFuturasAfetadas?: number
}

type Campo = 'nome' | 'valor' | 'mes' | 'categoria' | 'parcelas'
type Erros = Partial<Record<Campo, string>>

const MIN_PARCELAS = 2
const MAX_PARCELAS = 120
const ATALHOS_PARCELAS = [2, 3, 6, 10, 12]

const classeCampo =
  'w-full rounded-2xl border bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-950 dark:text-white dark:focus:bg-slate-950'

function bordaCampo(erro?: string) {
  return erro
    ? 'border-rose-400 dark:border-rose-500'
    : 'border-slate-200 dark:border-slate-700'
}

/**
 * Formulário de receitas e despesas.
 *
 * Deve ser montado somente quando aberto: o estado inicial é derivado
 * das props, e cada abertura monta um formulário novo.
 */
export default function TransactionModal({
  onClose,
  onSalvo,
  tipo: tipoInicial,
  mesAtual,
  transacaoParaEditar = null,
  totalParcelas,
  parcelasFuturasAfetadas,
}: TransactionModalProps) {
  const edicao = transacaoParaEditar
  const modoEdicao = !!edicao
  const ehParcela = !!edicao?.parcelamento_id
  const parcelaPaga = ehParcela && edicao?.status_pagamento === 'pago'

  const [tipo, setTipo] = useState<TipoTransacao>(edicao?.tipo ?? tipoInicial)
  const [nome, setNome] = useState(() =>
    edicao ? (ehParcela ? nomeBaseParcela(edicao.nome) : edicao.nome) : ''
  )
  const [valorCentavos, setValorCentavos] = useState(() =>
    edicao ? reaisParaCentavos(Number(edicao.valor_estimado)) : 0
  )
  const [categoriaId, setCategoriaId] = useState<number>(edicao?.categoria_id ?? 1)
  const [mes, setMes] = useState(edicao?.mes_referencia ?? mesAtual)
  const [parcelado, setParcelado] = useState(false)
  const [parcelasTexto, setParcelasTexto] = useState('2')
  const [escopo, setEscopo] = useState<EscopoEdicao>('unica')
  const [erros, setErros] = useState<Erros>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmandoLote, setConfirmandoLote] = useState(false)

  const tituloId = useId()
  const nomeRef = useRef<HTMLInputElement>(null)
  const valorRef = useRef<HTMLInputElement>(null)
  const mesRef = useRef<HTMLInputElement>(null)
  const parcelasRef = useRef<HTMLInputElement>(null)

  const ehDespesa = tipo === 'despesa'
  const podeParcelar = ehDespesa && !modoEdicao
  const quantidadeParcelas = Number(parcelasTexto)
  // Parcela paga: valor e mês só mudam depois de desfazer o pagamento.
  const valorEMesBloqueados = parcelaPaga

  /* Foco automático no campo principal. */
  useEffect(() => {
    const campo = nomeRef.current
    campo?.focus()
    if (modoEdicao) campo?.select()
  }, [modoEdicao])

  /* Esc fecha (exceto durante o salvamento). */
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape' || salvando) return
      if (confirmandoLote) setConfirmandoLote(false)
      else onClose()
    }

    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onClose, salvando, confirmandoLote])

  /* Prévia da distribuição das parcelas. */
  const previa = useMemo(() => {
    if (!parcelado || !podeParcelar) return null
    if (!Number.isInteger(quantidadeParcelas)) return null
    if (quantidadeParcelas < MIN_PARCELAS || quantidadeParcelas > MAX_PARCELAS) return null
    if (valorCentavos < quantidadeParcelas) return null

    const valores = distribuirParcelas(valorCentavos, quantidadeParcelas)
    const maior = valores[0]
    const menor = valores[valores.length - 1]
    const qtdMaior = valores.filter((v) => v === maior).length
    const mesValido = normalizarMes(mes)

    return {
      linhas:
        maior === menor
          ? [`${quantidadeParcelas}x de ${formatarCentavos(maior)}`]
          : [
              `${qtdMaior}x de ${formatarCentavos(maior)}`,
              `${quantidadeParcelas - qtdMaior}x de ${formatarCentavos(menor)}`,
            ],
      periodo: mesValido
        ? `${formatarMesCurto(mesValido)} a ${formatarMesCurto(adicionarMeses(mesValido, quantidadeParcelas - 1))}`
        : null,
    }
  }, [parcelado, podeParcelar, quantidadeParcelas, valorCentavos, mes])

  const validar = (): Erros => {
    const novos: Erros = {}

    if (!nome.trim()) novos.nome = 'Informe um nome.'
    else if (nome.trim().length > 120) novos.nome = 'Use no máximo 120 caracteres.'

    if (valorCentavos <= 0) novos.valor = 'Informe um valor maior que zero.'

    if (!normalizarMes(mes)) novos.mes = 'Escolha um mês válido.'

    if (ehDespesa && !CATEGORIAS.some((c) => c.id === categoriaId)) {
      novos.categoria = 'Selecione uma categoria.'
    }

    if (podeParcelar && parcelado) {
      if (
        !Number.isInteger(quantidadeParcelas) ||
        quantidadeParcelas < MIN_PARCELAS ||
        quantidadeParcelas > MAX_PARCELAS
      ) {
        novos.parcelas = `Escolha entre ${MIN_PARCELAS} e ${MAX_PARCELAS} parcelas.`
      } else if (valorCentavos > 0 && valorCentavos < quantidadeParcelas) {
        novos.parcelas = 'O valor é pequeno demais para essa quantidade de parcelas.'
      }
    }

    return novos
  }

  const focarPrimeiroErro = (lista: Erros) => {
    if (lista.nome) nomeRef.current?.focus()
    else if (lista.valor) valorRef.current?.focus()
    else if (lista.mes) mesRef.current?.focus()
    else if (lista.parcelas) parcelasRef.current?.focus()
  }

  const salvar = async () => {
    setSalvando(true)
    setErroGeral(null)

    try {
      const resultado =
        modoEdicao && edicao
          ? await atualizarTransacao({
              id: edicao.id,
              nome,
              valorCentavos,
              mesReferencia: mes,
              categoriaId: ehDespesa ? categoriaId : undefined,
              escopo: ehParcela ? escopo : undefined,
            })
          : await adicionarTransacao({
              nome,
              valorCentavos,
              mesReferencia: mes,
              tipo,
              categoriaId: ehDespesa ? categoriaId : undefined,
              parcelas: podeParcelar && parcelado ? quantidadeParcelas : 1,
            })

      if (!resultado.ok) {
        // Mantém tudo o que foi preenchido para o usuário corrigir.
        setErroGeral(resultado.erro)
        setConfirmandoLote(false)
        return
      }

      onSalvo(resultado.mensagem)
    } catch (error) {
      console.error(error)
      setErroGeral('Não foi possível salvar. Verifique sua conexão e tente novamente.')
      setConfirmandoLote(false)
    } finally {
      setSalvando(false)
    }
  }

  const handleSubmit = (evento: FormEvent) => {
    evento.preventDefault()
    if (salvando) return

    const lista = validar()
    setErros(lista)

    if (Object.keys(lista).length > 0) {
      focarPrimeiroErro(lista)
      return
    }

    // Operações que afetam várias parcelas exigem confirmação.
    if (ehParcela && escopo === 'futuras' && !confirmandoLote) {
      setConfirmandoLote(true)
      return
    }

    void salvar()
  }

  const limparErro = (campo: Campo) => {
    if (erros[campo]) setErros((atual) => ({ ...atual, [campo]: undefined }))
  }

  const alterarParcelas = (delta: number) => {
    const atual = Number.isInteger(quantidadeParcelas) ? quantidadeParcelas : MIN_PARCELAS
    const proximo = Math.min(MAX_PARCELAS, Math.max(MIN_PARCELAS, atual + delta))
    setParcelasTexto(String(proximo))
    limparErro('parcelas')
  }

  const titulo = modoEdicao
    ? ehParcela
      ? 'Editar parcela'
      : `Editar ${tipo === 'receita' ? 'receita' : 'despesa'}`
    : `Nova ${tipo === 'receita' ? 'receita' : 'despesa'}`

  const rotuloSalvar = salvando
    ? 'Salvando...'
    : modoEdicao
      ? 'Salvar alterações'
      : parcelado && podeParcelar
        ? 'Criar parcelamento'
        : tipo === 'receita'
          ? 'Adicionar receita'
          : 'Adicionar despesa'

  const corPrimaria =
    tipo === 'receita' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'

  const rotuloValor =
    podeParcelar && parcelado
      ? 'Valor total da compra'
      : ehParcela && escopo === 'futuras'
        ? 'Valor de cada parcela'
        : ehParcela
          ? 'Valor da parcela'
          : 'Valor'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget && !salvando) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-3xl"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h3 id={tituloId} className="text-lg font-bold text-slate-900 dark:text-white">
              {titulo}
            </h3>
            {ehParcela && edicao?.numero_parcela && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Parcela {edicao.numero_parcela}
                {totalParcelas ? ` de ${totalParcelas}` : ''}
                {parcelaPaga ? ' · paga' : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            aria-label="Fechar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {erroGeral && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
              >
                <span className="mt-0.5 shrink-0"><Icon name="alert" size={16} /></span>
                <span>{erroGeral}</span>
              </div>
            )}

            {/* Tipo (somente ao criar) */}
            {!modoEdicao && (
              <fieldset>
                <legend className="sr-only">Tipo de transação</legend>
                <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
                  {(['receita', 'despesa'] as const).map((opcao) => {
                    const ativo = tipo === opcao
                    return (
                      <label
                        key={opcao}
                        className={`flex min-h-10 cursor-pointer items-center justify-center rounded-xl text-sm font-bold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500 ${
                          ativo
                            ? opcao === 'receita'
                              ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-950 dark:text-emerald-400'
                              : 'bg-white text-rose-600 shadow-sm dark:bg-slate-950 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <input
                          type="radio"
                          name="tipo"
                          value={opcao}
                          checked={ativo}
                          onChange={() => {
                            setTipo(opcao)
                            if (opcao === 'receita') setParcelado(false)
                          }}
                          className="sr-only"
                        />
                        {opcao === 'receita' ? 'Receita' : 'Despesa'}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {/* Nome */}
            <div>
              <label htmlFor="campo-nome" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                {ehParcela ? 'Nome da compra' : 'Nome'}
              </label>
              <input
                ref={nomeRef}
                id="campo-nome"
                type="text"
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value)
                  limparErro('nome')
                }}
                placeholder={tipo === 'receita' ? 'Ex.: Salário' : 'Ex.: Mercado, Notebook'}
                autoComplete="off"
                autoCapitalize="sentences"
                enterKeyHint="next"
                maxLength={120}
                aria-invalid={!!erros.nome}
                aria-describedby={erros.nome ? 'erro-nome' : undefined}
                className={`${classeCampo} ${bordaCampo(erros.nome)}`}
              />
              {erros.nome && <p id="erro-nome" className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.nome}</p>}
            </div>

            {/* Valor */}
            <div>
              <label htmlFor="campo-valor" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                {rotuloValor}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-slate-400">
                  R$
                </span>
                <input
                  ref={valorRef}
                  id="campo-valor"
                  type="text"
                  inputMode="numeric"
                  enterKeyHint="next"
                  autoComplete="off"
                  value={centavosParaTextoCampo(valorCentavos)}
                  onChange={(e) => {
                    setValorCentavos(textoParaCentavos(e.target.value))
                    limparErro('valor')
                  }}
                  placeholder="0,00"
                  disabled={valorEMesBloqueados}
                  aria-invalid={!!erros.valor}
                  aria-describedby={erros.valor ? 'erro-valor' : valorEMesBloqueados ? 'aviso-paga' : undefined}
                  className={`${classeCampo} ${bordaCampo(erros.valor)} pl-12 text-right text-lg font-bold tabular-nums`}
                />
              </div>
              {erros.valor && <p id="erro-valor" className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.valor}</p>}
            </div>

            {/* Categoria (despesas) */}
            {ehDespesa && (
              <fieldset>
                <legend className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Categoria</legend>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORIAS.map((categoria) => {
                    const ativa = categoriaId === categoria.id
                    return (
                      <label
                        key={categoria.id}
                        className={`flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-2xl border px-2 py-2 text-center text-xs font-bold leading-tight transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500 ${
                          ativa
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="categoria"
                          value={categoria.id}
                          checked={ativa}
                          onChange={() => {
                            setCategoriaId(categoria.id)
                            limparErro('categoria')
                          }}
                          className="sr-only"
                        />
                        {categoria.nome}
                        <span className="mt-0.5 text-[10px] font-semibold opacity-70">{categoria.meta}%</span>
                      </label>
                    )
                  })}
                </div>
                {erros.categoria && <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.categoria}</p>}
              </fieldset>
            )}

            {/* Mês */}
            <div>
              <label htmlFor="campo-mes" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                {podeParcelar && parcelado ? 'Mês da 1ª parcela' : 'Mês de referência'}
              </label>
              <input
                ref={mesRef}
                id="campo-mes"
                type="month"
                value={mes}
                onChange={(e) => {
                  setMes(e.target.value)
                  limparErro('mes')
                }}
                disabled={valorEMesBloqueados}
                aria-invalid={!!erros.mes}
                aria-describedby={erros.mes ? 'erro-mes' : undefined}
                className={`${classeCampo} ${bordaCampo(erros.mes)}`}
              />
              {erros.mes && <p id="erro-mes" className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.mes}</p>}
            </div>

            {valorEMesBloqueados && (
              <p id="aviso-paga" className="flex items-start gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <span className="mt-0.5 shrink-0"><Icon name="check" size={14} /></span>
                Esta parcela já foi paga. Para preservar o histórico, valor e mês só podem ser alterados depois de desfazer o pagamento.
              </p>
            )}

            {/* Parcelamento (nova despesa) */}
            {podeParcelar && (
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <label className="flex cursor-pointer items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Compra parcelada</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">Divide o valor total entre os meses</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={parcelado}
                    onChange={(e) => {
                      setParcelado(e.target.checked)
                      limparErro('parcelas')
                    }}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className="relative h-7 w-12 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5 dark:bg-slate-600 dark:peer-focus-visible:ring-offset-slate-900"
                  />
                </label>

                {parcelado && (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label htmlFor="campo-parcelas" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Quantidade de parcelas
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => alterarParcelas(-1)}
                          aria-label="Diminuir parcelas"
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-xl font-bold text-slate-600 transition hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          −
                        </button>
                        <input
                          ref={parcelasRef}
                          id="campo-parcelas"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={parcelasTexto}
                          onChange={(e) => {
                            setParcelasTexto(e.target.value.replace(/\D/g, '').slice(0, 3))
                            limparErro('parcelas')
                          }}
                          aria-invalid={!!erros.parcelas}
                          aria-describedby={erros.parcelas ? 'erro-parcelas' : 'previa-parcelas'}
                          className={`${classeCampo} ${bordaCampo(erros.parcelas)} text-center text-lg font-bold tabular-nums`}
                        />
                        <button
                          type="button"
                          onClick={() => alterarParcelas(1)}
                          aria-label="Aumentar parcelas"
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-xl font-bold text-slate-600 transition hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          +
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ATALHOS_PARCELAS.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => {
                              setParcelasTexto(String(n))
                              limparErro('parcelas')
                            }}
                            aria-pressed={quantidadeParcelas === n}
                            className={`h-8 rounded-lg px-3 text-xs font-bold transition ${
                              quantidadeParcelas === n
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                            }`}
                          >
                            {n}x
                          </button>
                        ))}
                      </div>
                      {erros.parcelas && (
                        <p id="erro-parcelas" className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.parcelas}</p>
                      )}
                    </div>

                    <div id="previa-parcelas" aria-live="polite" className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                      {previa ? (
                        <>
                          <p className="font-bold text-slate-800 dark:text-slate-100">{previa.linhas.join(' + ')}</p>
                          {previa.periodo && <p className="mt-0.5">{previa.periodo}</p>}
                        </>
                      ) : (
                        <p>Informe o valor total para ver as parcelas.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Escopo da edição (parcelas) */}
            {ehParcela && (
              <fieldset className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <legend className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Aplicar alterações em</legend>
                <div className="mt-1 space-y-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl p-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <input
                      type="radio"
                      name="escopo"
                      checked={escopo === 'unica'}
                      onChange={() => setEscopo('unica')}
                      className="mt-0.5 h-5 w-5 accent-emerald-600"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Somente esta parcela</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">As demais parcelas não mudam.</span>
                    </span>
                  </label>
                  <label className={`flex items-start gap-3 rounded-xl p-2 ${parcelaPaga ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}>
                    <input
                      type="radio"
                      name="escopo"
                      checked={escopo === 'futuras'}
                      onChange={() => setEscopo('futuras')}
                      disabled={parcelaPaga}
                      className="mt-0.5 h-5 w-5 accent-emerald-600"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Esta e as próximas</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        Parcelas já pagas são preservadas.
                        {escopo === 'futuras' && mes !== edicao?.mes_referencia
                          ? ' Ao mudar o mês, as próximas são deslocadas na mesma proporção.'
                          : ''}
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>
            )}
          </div>

          {/* Rodapé */}
          <div className="border-t border-slate-100 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 dark:border-slate-800">
            {confirmandoLote ? (
              <div role="alertdialog" aria-labelledby="confirmacao-lote" className="space-y-3">
                <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <p id="confirmacao-lote" className="font-bold">Alterar várias parcelas?</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    {parcelasFuturasAfetadas !== undefined
                      ? `${parcelasFuturasAfetadas} ${parcelasFuturasAfetadas === 1 ? 'parcela será alterada' : 'parcelas serão alteradas'}`
                      : `A parcela ${edicao?.numero_parcela ?? ''} e as seguintes serão alteradas`}
                    {' '}com o nome, a categoria e o valor de {formatarCentavos(valorCentavos)} cada.
                    Parcelas pagas e anteriores não serão modificadas.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setConfirmandoLote(false)}
                    disabled={salvando}
                    className="h-12 flex-1 rounded-2xl bg-slate-100 text-sm font-bold text-slate-700 transition active:scale-[0.98] disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => void salvar()}
                    disabled={salvando}
                    autoFocus
                    className="h-12 flex-1 rounded-2xl bg-amber-600 text-sm font-bold text-white transition hover:bg-amber-700 active:scale-[0.98] disabled:opacity-60"
                  >
                    {salvando ? 'Salvando...' : 'Confirmar alteração'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={salvando}
                  className="h-12 flex-1 rounded-2xl bg-slate-100 text-sm font-bold text-slate-700 transition active:scale-[0.98] disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  aria-busy={salvando}
                  className={`flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60 ${corPrimaria}`}
                >
                  {salvando && (
                    <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  )}
                  {rotuloSalvar}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
