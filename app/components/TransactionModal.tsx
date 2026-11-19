'use client'

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { adicionarTransacao, atualizarTransacao, criarRecorrencia, registrarCompraCartao } from '@/app/actions'
import Icon from '@/app/components/Icon'
import { FORMAS_PAGAMENTO, FormaPagamento, ciclosDasParcelas } from '@/app/lib/cartoes'
import { dataNoMes, dataValida, formatarData, formatarDataCurta, hoje, partes } from '@/app/lib/datas'
import { adicionarMeses, formatarMesCurto, normalizarMes } from '@/app/lib/meses'
import { FREQUENCIAS, Frequencia, descreverFrequencia, ocorrenciasEntre } from '@/app/lib/recorrencias'
import {
  centavosParaTextoCampo,
  distribuirParcelas,
  formatarCentavos,
  reaisParaCentavos,
  textoParaCentavos,
} from '@/app/lib/money'
import {
  CATEGORIAS,
  Cartao,
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
  recorrencia_id?: string | null
  data_vencimento?: string | null
  fatura_id?: string | null
  cartao_id?: string | null
}

/** Como a nova transação se repete. */
export type ModoLancamento = 'unica' | 'parcelada' | 'recorrente'

interface TransactionModalProps {
  onClose: () => void
  /** Chamado após salvar com sucesso, com a mensagem de confirmação. */
  onSalvo: (mensagem: string) => void
  tipo: TipoTransacao
  /** Modo inicial ao criar (ex.: "Nova recorrência" abre em 'recorrente'). */
  modoInicial?: ModoLancamento
  formaInicial?: FormaPagamento
  cartaoInicial?: string
  /** Cartões do usuário (para compras no crédito). */
  cartoes?: Cartao[]
  mesAtual: string
  transacaoParaEditar?: TransacaoEditavel | null
  /** Total de parcelas do parcelamento (apenas para exibição). */
  totalParcelas?: number
  /** Quantas parcelas "esta e as próximas" afetaria (quando conhecido). */
  parcelasFuturasAfetadas?: number
}

type Campo = 'nome' | 'valor' | 'mes' | 'categoria' | 'parcelas' | 'dataInicio' | 'dataFim' | 'intervalo' | 'cartao' | 'dataCompra'
type Erros = Partial<Record<Campo, string>>

const MIN_PARCELAS = 2
const MAX_PARCELAS = 120
const ATALHOS_PARCELAS = [2, 3, 6, 10, 12]

const UNIDADE_INTERVALO: Record<Frequencia, [string, string]> = {
  semanal: ['semana', 'semanas'],
  mensal: ['mês', 'meses'],
  anual: ['ano', 'anos'],
}

/** Primeira ocorrência sugerida: hoje, ou o mesmo dia no mês visualizado. */
function dataInicialSugerida(mes: string): string {
  const dataHoje = hoje()
  if (!normalizarMes(mes) || dataHoje.startsWith(mes)) return dataHoje
  const [ano, numero] = mes.split('-').map(Number)
  return dataNoMes(ano, numero, partes(dataHoje).dia)
}

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
  modoInicial = 'unica',
  formaInicial,
  cartaoInicial,
  cartoes = [],
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
  const [modo, setModo] = useState<ModoLancamento>(() =>
    edicao ? 'unica' : modoInicial === 'parcelada' && tipoInicial !== 'despesa' ? 'unica' : modoInicial
  )
  const [frequencia, setFrequencia] = useState<Frequencia>('mensal')
  const [intervaloTexto, setIntervaloTexto] = useState('1')
  const [dataInicio, setDataInicio] = useState(() => dataInicialSugerida(mesAtual))
  const [temFim, setTemFim] = useState(false)
  const [dataFim, setDataFim] = useState('')
  const cartoesAtivos = cartoes.filter((c) => c.ativo)
  const [forma, setForma] = useState<FormaPagamento | null>(formaInicial ?? null)
  const [cartaoId, setCartaoId] = useState<string>(cartaoInicial ?? cartoesAtivos[0]?.id ?? '')
  const [dataCompra, setDataCompra] = useState(() => dataInicialSugerida(mesAtual))
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
  const ehOcorrencia = !!edicao?.recorrencia_id
  const podeParcelar = ehDespesa && !modoEdicao
  const parcelado = modo === 'parcelada' && podeParcelar
  const recorrente = modo === 'recorrente' && !modoEdicao
  const intervalo = Number(intervaloTexto)
  const credito = ehDespesa && !modoEdicao && forma === 'credito'
  const cartaoSelecionado = cartoesAtivos.find((c) => c.id === cartaoId) ?? null
  const compraNoCartaoEditada = !!edicao?.fatura_id
  const cartaoDaEdicao = edicao?.cartao_id ? cartoes.find((c) => c.id === edicao.cartao_id) ?? null : null

  const quantidadeParcelas = Number(parcelasTexto)
  /* Fatura em que a compra (ou cada parcela) vai entrar. */
  const previaFatura = (() => {
    if (!credito || recorrente || !cartaoSelecionado || !dataValida(dataCompra)) return null
    const qtd = parcelado && Number.isInteger(quantidadeParcelas) && quantidadeParcelas >= 2 ? Math.min(quantidadeParcelas, MAX_PARCELAS) : 1
    const ciclos = ciclosDasParcelas(cartaoSelecionado, dataCompra, qtd)
    return { primeira: ciclos[0], ultima: ciclos[ciclos.length - 1], quantidade: qtd }
  })()
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

  /* Prévia das próximas ocorrências. */
  const previaRecorrencia = useMemo(() => {
    if (!recorrente || !dataValida(dataInicio)) return null
    if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 24) return null
    const regra = {
      frequencia,
      intervalo,
      data_inicio: dataInicio,
      data_fim: temFim && dataValida(dataFim) ? dataFim : null,
    }
    const proximas = ocorrenciasEntre(regra, dataInicio, '9999-12-31', 3)
    return { descricao: descreverFrequencia(regra), proximas }
  }, [recorrente, dataInicio, intervalo, frequencia, temFim, dataFim])

  const validar = (): Erros => {
    const novos: Erros = {}

    if (!nome.trim()) novos.nome = 'Informe um nome.'
    else if (nome.trim().length > 120) novos.nome = 'Use no máximo 120 caracteres.'

    if (valorCentavos <= 0) novos.valor = 'Informe um valor maior que zero.'

    if (recorrente) {
      if (!dataValida(dataInicio)) novos.dataInicio = 'Escolha a data da primeira ocorrência.'
      if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 24) {
        novos.intervalo = 'Use um número entre 1 e 24.'
      }
      if (temFim) {
        if (!dataValida(dataFim)) novos.dataFim = 'Escolha a data final.'
        else if (dataValida(dataInicio) && dataFim < dataInicio) {
          novos.dataFim = 'A data final deve ser depois da primeira ocorrência.'
        }
      }
    } else if (credito) {
      if (!dataValida(dataCompra)) novos.dataCompra = 'Informe a data da compra.'
    } else if (!normalizarMes(mes)) {
      novos.mes = 'Escolha um mês válido.'
    }

    if (credito && !cartaoSelecionado) {
      novos.cartao = cartoesAtivos.length ? 'Escolha o cartão.' : 'Cadastre um cartão em Cartões para lançar no crédito.'
    }

    if (ehDespesa && !CATEGORIAS.some((c) => c.id === categoriaId)) {
      novos.categoria = 'Selecione uma categoria.'
    }

    if (parcelado) {
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
    else if (lista.dataInicio) document.getElementById('campo-data-inicio')?.focus()
    else if (lista.intervalo) document.getElementById('campo-intervalo')?.focus()
    else if (lista.dataFim) document.getElementById('campo-data-fim')?.focus()
    else if (lista.dataCompra) document.getElementById('campo-data-compra')?.focus()
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
          : recorrente
            ? await criarRecorrencia({
                nome,
                valorCentavos,
                tipo,
                categoriaId: ehDespesa ? categoriaId : undefined,
                frequencia,
                intervalo,
                dataInicio,
                dataFim: temFim ? dataFim : null,
                mesVisualizado: mesAtual,
                formaPagamento: ehDespesa ? forma : null,
                cartaoId: credito ? cartaoId : null,
              })
            : credito
              ? await registrarCompraCartao({
                  cartaoId,
                  nome,
                  valorCentavos,
                  categoriaId,
                  dataCompra,
                  parcelas: parcelado ? quantidadeParcelas : 1,
                })
              : await adicionarTransacao({
                  nome,
                  valorCentavos,
                  mesReferencia: mes,
                  tipo,
                  categoriaId: ehDespesa ? categoriaId : undefined,
                  parcelas: parcelado ? quantidadeParcelas : 1,
                  formaPagamento: ehDespesa && forma && forma !== 'credito' ? forma : null,
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
    : recorrente
      ? `${tipo === 'receita' ? 'Receita' : 'Conta'} recorrente`
      : `Nova ${tipo === 'receita' ? 'receita' : 'despesa'}`

  const rotuloSalvar = salvando
    ? 'Salvando...'
    : modoEdicao
      ? 'Salvar alterações'
      : credito && !recorrente
        ? 'Lançar no cartão'
        : parcelado
        ? 'Criar parcelamento'
        : recorrente
          ? 'Criar recorrência'
          : tipo === 'receita'
            ? 'Adicionar receita'
            : 'Adicionar despesa'

  const corPrimaria =
    tipo === 'receita' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'

  const rotuloValor =
    parcelado
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
                            if (opcao === 'receita' && modo === 'parcelada') setModo('unica')
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

            {/* Forma de pagamento (despesas novas) */}
            {ehDespesa && !modoEdicao && (
              <fieldset>
                <legend className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Pagamento <span className="font-normal text-slate-400">(opcional)</span>
                </legend>
                <div className="grid grid-cols-4 gap-1.5">
                  {FORMAS_PAGAMENTO.map((f) => {
                    const ativo = forma === f.valor
                    return (
                      <button
                        key={f.valor}
                        type="button"
                        aria-pressed={ativo}
                        onClick={() => {
                          setForma(ativo ? null : f.valor)
                          limparErro('cartao')
                        }}
                        className={`flex min-h-10 items-center justify-center gap-1 rounded-xl border text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                          ativo
                            ? f.valor === 'credito'
                              ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300'
                              : 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {f.valor === 'credito' && <Icon name="credit-card" size={14} />}
                        {f.rotulo}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {/* Cartão (crédito) */}
            {credito && (
              <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/40 p-4 dark:border-sky-900/60 dark:bg-sky-950/20">
                {cartoesAtivos.length === 0 ? (
                  <p className="text-sm text-slate-700 dark:text-slate-200">
                    Nenhum cartão ativo.{' '}
                    <a href="/cartoes" className="font-bold text-sky-700 underline dark:text-sky-400">Cadastre um cartão</a>{' '}
                    para lançar compras no crédito.
                  </p>
                ) : (
                  <fieldset>
                    <legend className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Cartão</legend>
                    <div className="flex flex-wrap gap-2">
                      {cartoesAtivos.map((c) => (
                        <label
                          key={c.id}
                          className={`flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500 ${
                            cartaoId === c.id
                              ? 'border-sky-500 bg-white text-sky-800 shadow-sm dark:bg-slate-950 dark:text-sky-300'
                              : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="cartao"
                            checked={cartaoId === c.id}
                            onChange={() => {
                              setCartaoId(c.id)
                              limparErro('cartao')
                            }}
                            className="sr-only"
                          />
                          <Icon name="credit-card" size={15} />
                          {c.nome}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {erros.cartao && <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{erros.cartao}</p>}

                {!recorrente && (
                  <div>
                    <label htmlFor="campo-data-compra" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Data da compra
                    </label>
                    <input
                      id="campo-data-compra"
                      type="date"
                      value={dataCompra}
                      onChange={(e) => {
                        setDataCompra(e.target.value)
                        limparErro('dataCompra')
                      }}
                      aria-invalid={!!erros.dataCompra}
                      className={`${classeCampo} ${bordaCampo(erros.dataCompra)}`}
                    />
                    {erros.dataCompra && <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.dataCompra}</p>}
                  </div>
                )}

                {previaFatura && (
                  <p aria-live="polite" className="rounded-xl bg-white px-3 py-2.5 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                    {previaFatura.quantidade > 1 ? (
                      <>
                        Parcelas nas faturas de <strong className="capitalize">{formatarMesCurto(previaFatura.primeira.mes_referencia)}</strong> a{' '}
                        <strong className="capitalize">{formatarMesCurto(previaFatura.ultima.mes_referencia)}</strong>.
                      </>
                    ) : (
                      <>
                        Entra na fatura de <strong className="capitalize">{formatarMesCurto(previaFatura.primeira.mes_referencia)}</strong>{' '}
                        (fecha {formatarDataCurta(previaFatura.primeira.data_fechamento)}, vence {formatarData(previaFatura.primeira.data_vencimento)}).
                      </>
                    )}
                  </p>
                )}
                {credito && recorrente && cartaoSelecionado && (
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Cada cobrança entra na fatura correspondente à sua data.
                  </p>
                )}
              </div>
            )}

            {/* Repetição (somente ao criar) */}
            {!modoEdicao && (
              <fieldset>
                <legend className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Repetição</legend>
                <div className={`grid gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800 ${ehDespesa ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {([
                    ['unica', 'Única'],
                    ...(ehDespesa ? [['parcelada', 'Parcelada'] as const] : []),
                    ['recorrente', 'Recorrente'],
                  ] as const).map(([valor, rotulo]) => {
                    const ativo = modo === valor
                    return (
                      <label
                        key={valor}
                        className={`flex min-h-10 cursor-pointer items-center justify-center rounded-xl text-sm font-bold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500 ${
                          ativo ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <input
                          type="radio"
                          name="modo"
                          value={valor}
                          checked={ativo}
                          onChange={() => {
                            setModo(valor)
                            limparErro('parcelas')
                          }}
                          className="sr-only"
                        />
                        {rotulo}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {/* Recorrência */}
            {recorrente && (
              <div className="space-y-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <fieldset>
                  <legend className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Frequência</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {FREQUENCIAS.map((f) => (
                      <label
                        key={f.valor}
                        className={`flex min-h-10 cursor-pointer items-center justify-center rounded-xl border text-sm font-bold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500 ${
                          frequencia === f.valor
                            ? 'border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
                            : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <input type="radio" name="frequencia" value={f.valor} checked={frequencia === f.valor} onChange={() => setFrequencia(f.valor)} className="sr-only" />
                        {f.rotulo}
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <label htmlFor="campo-intervalo">Repetir a cada</label>
                    <input
                      id="campo-intervalo"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={intervaloTexto}
                      onChange={(e) => {
                        setIntervaloTexto(e.target.value.replace(/\D/g, '').slice(0, 2))
                        limparErro('intervalo')
                      }}
                      aria-invalid={!!erros.intervalo}
                      className={`${classeCampo} ${bordaCampo(erros.intervalo)} w-16 px-2 py-2 text-center font-bold`}
                    />
                    <span>{UNIDADE_INTERVALO[frequencia][intervalo === 1 ? 0 : 1]}</span>
                  </div>
                  {erros.intervalo && <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.intervalo}</p>}
                </fieldset>

                <div>
                  <label htmlFor="campo-data-inicio" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {tipo === 'receita' ? 'Primeiro recebimento' : 'Primeiro vencimento'}
                  </label>
                  <input
                    id="campo-data-inicio"
                    type="date"
                    value={dataInicio}
                    onChange={(e) => {
                      setDataInicio(e.target.value)
                      limparErro('dataInicio')
                    }}
                    aria-invalid={!!erros.dataInicio}
                    className={`${classeCampo} ${bordaCampo(erros.dataInicio)}`}
                  />
                  {erros.dataInicio && <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.dataInicio}</p>}
                </div>

                <div>
                  <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={temFim}
                      onChange={(e) => {
                        setTemFim(e.target.checked)
                        limparErro('dataFim')
                      }}
                      className="h-5 w-5 accent-emerald-600"
                    />
                    Tem data para terminar
                  </label>
                  {temFim && (
                    <input
                      id="campo-data-fim"
                      type="date"
                      value={dataFim}
                      min={dataValida(dataInicio) ? dataInicio : undefined}
                      onChange={(e) => {
                        setDataFim(e.target.value)
                        limparErro('dataFim')
                      }}
                      aria-label="Data final"
                      aria-invalid={!!erros.dataFim}
                      className={`${classeCampo} ${bordaCampo(erros.dataFim)} mt-2`}
                    />
                  )}
                  {erros.dataFim && <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.dataFim}</p>}
                  {!temFim && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sem data final: repete até você pausar ou encerrar.</p>}
                </div>

                <div aria-live="polite" className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                  {previaRecorrencia ? (
                    <>
                      <p className="font-bold text-slate-800 dark:text-slate-100">{previaRecorrencia.descricao}</p>
                      <p className="mt-0.5">
                        Próximas: {previaRecorrencia.proximas.map(formatarDataCurta).join(', ')}
                      </p>
                    </>
                  ) : (
                    <p>Escolha a frequência e a primeira data.</p>
                  )}
                </div>
              </div>
            )}

            {/* Mês */}
            {!recorrente && !credito && (
            <div>
              <label htmlFor="campo-mes" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                {parcelado ? 'Mês da 1ª parcela' : 'Mês de referência'}
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
                disabled={valorEMesBloqueados || compraNoCartaoEditada}
                aria-invalid={!!erros.mes}
                aria-describedby={erros.mes ? 'erro-mes' : undefined}
                className={`${classeCampo} ${bordaCampo(erros.mes)}`}
              />
              {erros.mes && <p id="erro-mes" className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">{erros.mes}</p>}
            </div>
            )}

            {compraNoCartaoEditada && (
              <p className="flex items-start gap-2 rounded-2xl bg-sky-50 px-4 py-3 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                <span className="mt-0.5 shrink-0"><Icon name="credit-card" size={14} /></span>
                <span>
                  Compra no cartão{cartaoDaEdicao ? ` ${cartaoDaEdicao.nome}` : ''}. O mês é o da fatura, definido pela data da
                  compra. Para mudar de fatura, exclua e lance novamente.
                </span>
              </p>
            )}

            {ehOcorrencia && (
              <p className="flex items-start gap-2 rounded-2xl bg-violet-50 px-4 py-3 text-xs text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
                <span className="mt-0.5 shrink-0"><Icon name="repeat" size={14} /></span>
                <span>
                  Esta é uma ocorrência de uma conta recorrente. As alterações valem só para ela.
                  Para mudar as próximas, edite a recorrência em Recorrentes.
                </span>
              </p>
            )}

            {valorEMesBloqueados && (
              <p id="aviso-paga" className="flex items-start gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <span className="mt-0.5 shrink-0"><Icon name="check" size={14} /></span>
                Esta parcela já foi paga. Para preservar o histórico, valor e mês só podem ser alterados depois de desfazer o pagamento.
              </p>
            )}

            {/* Parcelamento (nova despesa) */}
            {parcelado && (
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                {parcelado && (
                  <div className="space-y-3">
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
                          {previa.periodo && !credito && <p className="mt-0.5">{previa.periodo}</p>}
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
