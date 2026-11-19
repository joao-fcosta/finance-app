# Arquitetura do FinanceApp

Este documento registra as decisões de arquitetura e as regras financeiras implementadas nas fases 1 a 5. A regra que orienta tudo é: **o usuário cadastra uma informação uma única vez e o sistema cuida do restante.**

---

## 1. Visão geral

```text
Navegador (React 19, client components)
   │  chama Server Actions (app/actions.ts)
   ▼
Servidor Next.js 16 (Vercel)
   │  supabase.auth.getUser() → usuário da sessão (nunca do cliente)
   │  valida entradas, distribui centavos, chama RPCs
   ▼
Supabase PostgreSQL
   │  RLS em todas as tabelas (auth.uid() = usuario_id)
   │  RPCs plpgsql SECURITY INVOKER → operações compostas atômicas
```

- **Server Actions** concentram as operações financeiras e as validações. As mutações retornam `{ ok, mensagem | erro }` em vez de lançar exceção, porque em produção o Next.js oculta a mensagem dos erros lançados.
- **RPCs (funções PostgreSQL)** executam as operações que alteram várias linhas, cada uma em uma única transação. Todas são `SECURITY INVOKER`, então o RLS continua valendo, e todas filtram explicitamente por `usuario_id = auth.uid()`.
- **Funções puras em `app/lib/`** espelham as regras do banco (datas, ciclo de fatura, resumos) para prévias e indicadores. Testes garantem que o espelho em TypeScript e o SQL chegam ao mesmo resultado.

## 2. Modelo de dados

```text
auth.users
   │
   ├── categorias (1 Necessidades · 2 Estilo de vida · 3 Projetos e poupança)
   │
   ├── parcelamentos ─────────────┐   valor_contratado (original) · valor_total (soma atual)
   ├── recorrencias ──────────────┤   regra de repetição + status + gerada_ate
   ├── cartoes ── faturas ── pagamentos_fatura
   │                 │
   └── transacoes ◄──┴────────────┘   cada lançamento (despesa ou receita)
          parcelamento_id · recorrencia_id · cartao_id · fatura_id
          status_pagamento · pago_em · data_vencimento · data_compra · forma_pagamento
```

**Uma única tabela de lançamentos.** Parcelas, ocorrências de recorrências e compras no cartão são linhas comuns de `transacoes`. Assim o dashboard, o pagamento, a edição e a exclusão funcionam do mesmo jeito para todas, e não existe um segundo lugar onde o mesmo valor possa ser somado.

**Propriedade conjunta.** As chaves estrangeiras são compostas com `usuario_id`, por exemplo `(parcelamento_id, usuario_id) → parcelamentos(id, usuario_id)`. Assim, uma linha de um usuário não consegue apontar para dados de outro, já que a checagem de chave estrangeira não passa pelo RLS.

**Valores** são `numeric(10,2)` no banco e centavos inteiros no código, com limite de R$ 99.999.999,99.

**Status derivado.** O status da fatura, os totais e o limite utilizado são sempre calculados e nunca gravados, por isso não ficam desatualizados.

## 3. Regras financeiras

| # | Regra | Onde |
|---|---|---|
| 1 | A compra no cartão é a despesa de consumo, no mês da fatura (mês do vencimento). | `registrar_compra_cartao` |
| 2 | O pagamento da fatura liquida a obrigação: fica em `pagamentos_fatura` e **não** é despesa. | `pagar_fatura` |
| 3 | As parcelas futuras aparecem nos meses e nas faturas correspondentes. | `criar_parcelamento`, `registrar_compra_cartao` |
| 4 | Recorrências nunca alteram o histórico; editar só muda ocorrências futuras pendentes que não foram editadas individualmente. | `editar_recorrencia` |
| 5 | Parcelamento (valor dividido) e recorrência (valor repetido) são conceitos e tabelas diferentes. | — |
| 6 | Limite utilizado = compras no cartão (inclusive parcelas futuras) − pagamentos. | `limiteCartao` |
| 7 | Nenhum compromisso é contado duas vezes: as compras no cartão não viram "conta a pagar" individual, porque entram pela fatura. | `app/lib/painel.ts` |
| 8 | A distribuição em centavos é exata: os centavos que sobram vão para as primeiras parcelas. | `distribuirParcelas` |
| 9 | Fechamento e vencimento respeitam o calendário; um dia inexistente vira o último dia do mês. | `fase3_ciclo_fatura`, `cicloDaCompra` |
| 10 | "Hoje" é calculado no fuso de Brasília, também no banco (que roda em UTC). | `fase2_hoje()`, `hoje()` |

### Indicadores do dashboard

```text
Despesas do mês      = todas as despesas do mês (inclui compras no cartão)
Pago                 = contas pagas (fora do cartão) + pagamentos das faturas do mês
A pagar              = contas pendentes (fora do cartão) + saldo das faturas do mês
Disponível agora     = receitas − pago
Saldo previsto       = receitas − despesas
Identidade testada:  pago + a pagar = despesas
```

Registros anteriores ao controle de pagamento (`status_pagamento = NULL`) não são presumidos pagos nem atrasados. Eles entram como pendentes só a partir do mês atual; os de meses passados não viram "vencidas".

## 4. Recorrências: geração idempotente

**Estratégia: geração sob demanda no servidor.** O projeto não tem `pg_cron`. Toda vez que os dados de um mês são consultados, a Server Action chama `gerar_ocorrencias(p_ate)`, que cria o que falta até o fim do mês visualizado, no mínimo 3 meses à frente de hoje e no máximo 10 anos.

- Funciona mesmo que o usuário passe meses sem abrir o app: o atraso é recuperado no próximo acesso.
- O código do navegador não participa da geração: ela roda no servidor e no banco.

**Garantias contra duplicidade:**

1. índice único `(recorrencia_id, data_vencimento)` com `ON CONFLICT DO NOTHING`;
2. marca d'água `gerada_ate`: as datas já processadas não são geradas de novo, por isso uma ocorrência excluída não "volta";
3. a recorrência fica travada (`FOR UPDATE`) durante a geração, então duas chamadas simultâneas não competem.

**Datas** são sempre `início + n × período`, sem acumular ajustes. Uma conta do dia 31 cai em 28/02 e volta para 31/03.

**Pausar** remove as futuras pendentes e recua a marca d'água para hoje. **Reativar** volta a gerar a partir de hoje, sem cobrar o período pausado. **Encerrar** e **excluir** preservam o passado.

## 5. Cartões: ciclo da fatura

```text
compra ANTES do dia de fechamento → fatura que fecha naquele mês
compra no dia do fechamento ou depois → fatura seguinte
vencimento > fechamento → vence no mesmo mês do fechamento
vencimento ≤ fechamento → vence no mês seguinte
mês da fatura = mês do vencimento
parcela i → fatura (i − 1) ciclos depois
```

Exemplo, com fechamento no dia 25 e vencimento no dia 5:
- compra em 20/11: fatura que fecha em 25/11 e vence em 05/12;
- compra em 27/11: fatura que fecha em 25/12 e vence em 05/01.

Alterar os dias de um cartão muda só as faturas que ainda não fecharam. Um cartão com compras não pode ser excluído; a opção é desativá-lo.

## 6. Migrations

Ficam em `supabase/migrations/` e devem ser aplicadas em ordem:

| Arquivo | Conteúdo |
|---|---|
| `20261118120000_fase1_pagamento_e_rpcs_parcelamento.sql` | Status de pagamento, `valor_contratado`, FK composta, RPCs de parcelamento |
| `20261119090000_fase2_recorrencias.sql` | `recorrencias`, geração idempotente, cancelamento de parcelas futuras |
| `20261119120000_fase3_cartoes_faturas.sql` | `cartoes`, `faturas`, `pagamentos_fatura`, compras no crédito, recorrência no cartão |

Todas as migrations:
- verificam os pré-requisitos e abortam sem alterar nada se algo divergir;
- são idempotentes;
- não removem colunas nem alteram dados existentes;
- criam RLS e privilégios mínimos nas tabelas novas (`anon` sem acesso; `authenticated` sem `TRUNCATE`);
- revogam `EXECUTE` de `anon` nas funções.

**Compatibilidade durante o deploy:** o código tolera banco com migrations faltando.
- A consulta de transações tenta conjuntos menores de colunas.
- A geração de ocorrências é ignorada se a função não existir.
- As telas novas mostram "aplique a migration".

Isso permite publicar o código antes de aplicar as migrations, sem quebrar o que já funcionava.

## 7. Testes

`npm test` (Vitest) executa:

- **Testes unitários** (`tests/*.test.ts`): centavos, datas, recorrências, ciclo de fatura, status, limite, resumo do dashboard e a ausência de contagem dupla.
- **Testes SQL** (`tests/sql/*.test.ts`): um PostgreSQL real em WASM (PGlite), montado com o esquema espelhado do Supabase (`tests/sql/esquema-base.sql`) e com todas as migrations aplicadas em ordem. Cobrem:
  - atomicidade, RLS e isolamento entre usuários;
  - geração de recorrências sem duplicidade;
  - compras antes e depois do fechamento;
  - pagamento parcial e total;
  - paridade entre SQL e TypeScript do ciclo de fatura em mais de 300 casos.

A data de "hoje" é fixada nos testes por `set_config('app.hoje', ...)`, uma configuração que a API do Supabase não permite definir.

## 8. Interface

- Uma barra inferior fixa dá acesso a Início, Recorrentes, Parcelas e Cartões. O botão "+" central abre o lançamento rápido, com Nova despesa, Nova receita, Compra no cartão e Nova recorrência.
- O formulário é contextual:
  - repetição: única, parcelada ou recorrente;
  - forma de pagamento opcional;
  - crédito pede o cartão e a data da compra, e mostra em qual fatura a compra vai entrar;
  - o mês só aparece quando faz sentido.
- Valores são digitados no teclado numérico, preenchendo a partir dos centavos. A tela tem foco automático, validação por campo, estados de carregamento e avisos de sucesso e erro.
- Tema claro e escuro e layout mobile-first em todas as telas. Ícones em SVG, sem emojis.
