# <p align="center">FinanceApp</p>

<p align="center">
  <strong>Controle Financeiro Pessoal</strong><br>
  Engenharia de Software | Unicatólica-TO
</p>

---

## Sobre

O **FinanceApp** é uma aplicação web progressiva (PWA) para controle financeiro pessoal, desenvolvida com foco em **simplicidade, praticidade e segurança**.

A ideia central: **você cadastra uma informação uma única vez e o sistema cuida do restante.** Contas fixas se repetem sozinhas, compras no cartão caem na fatura certa e o painel mostra quanto você realmente tem disponível e o que ainda precisa pagar.

O sistema usa autenticação via Google e armazena os dados no **Supabase**, com os dados de cada usuário isolados dos demais.

---

## Principais Funcionalidades

**Lançamento rápido:**
O botão **+** da barra inferior abre Nova despesa, Nova receita, Compra no cartão ou Nova recorrência. O formulário só mostra o que faz sentido para cada caso: com crédito, pede o cartão e a data da compra; numa compra parcelada, a quantidade de parcelas; numa conta recorrente, a frequência.

**Painel financeiro:**
- *Disponível agora:* receitas do mês menos o que já foi pago.
- *Saldo previsto:* receitas menos despesas.
- Receitas, despesas, contas a pagar e faturas em aberto.
- Próximos vencimentos (30 dias), com as contas vencidas em destaque.
- Compromissos dos próximos 6 meses e gastos por categoria (50/30/20).

O mesmo valor nunca é contado duas vezes: as compras no cartão aparecem dentro da fatura, e o pagamento da fatura não vira uma nova despesa.

**Contas recorrentes:**
- Frequência semanal, mensal ou anual, ou a cada N semanas, meses ou anos.
- Data final opcional.
- É possível pausar, reativar, encerrar, editar e excluir.

As ocorrências são geradas no servidor, sem duplicar, inclusive dos meses em que o app não foi aberto. Editar uma recorrência altera só as próximas ocorrências pendentes; o histórico e as ocorrências editadas individualmente são preservados.

**Cartões de crédito e faturas:**
- **Cartões:** cadastro com limite, dia de fechamento e dia de vencimento. Cada cartão mostra o limite utilizado e o disponível, a fatura atual e as próximas datas.
- **Compras:** a compra no crédito escolhe a fatura pela data e pelo fechamento do cartão. A compra parcelada distribui as parcelas nas faturas seguintes, com a soma exata.
- **Faturas:** status calculado automaticamente (aberta, fechada, paga parcialmente, paga ou vencida), com as compras de cada uma. O pagamento pode ser total ou parcial.

**Parcelamentos:**
- **Divisão em centavos:** R$ 100,00 em 3x vira R$ 33,34 + R$ 33,33 + R$ 33,33, sempre somando o total.
- **Tela de parcelamentos:** ativos e finalizados, com valor contratado, parcelas pagas e pendentes, saldo restante, próxima parcela e progresso.
- **Edição:** só esta parcela, ou esta e as próximas. Parcelas pagas não mudam.
- **Exclusão:** de uma parcela, das parcelas futuras ou do parcelamento inteiro, sempre com confirmação.

**Controle de pagamento:**
Toda despesa pode ser marcada como paga, com a data registrada; desfazer pede confirmação. Registros anteriores a esse controle aparecem como "sem status": o sistema não presume que foram pagos.

**Categorias financeiras:**
Necessidades (50%), Estilo de Vida (30%) e Projetos e Poupança (20%).

**Navegação mensal, tema claro e escuro, mobile first e login com Google.**

---

## Tecnologias Utilizadas

* **Front-end:** Next.js 16, React 19, TypeScript, Tailwind CSS 4
* **Back-end:** Next.js Server Actions, Supabase, PostgreSQL (funções plpgsql)
* **Autenticação:** Supabase Auth com Google OAuth 2.0
* **Segurança:** Row Level Security (RLS) com `auth.uid()`
* **Testes:** Vitest e PGlite (PostgreSQL em WASM)
* **Deploy:** Vercel

---

## Banco de Dados

```text
auth.users
   ├── categorias
   ├── parcelamentos        compras parceladas (valor contratado e soma atual)
   ├── recorrencias         regras de contas recorrentes
   ├── cartoes
   │     └── faturas        uma por cartão e mês de vencimento
   │           └── pagamentos_fatura
   └── transacoes           todos os lançamentos (parcelas, ocorrências e
                            compras no cartão também são transações)
```

As decisões de modelo, as regras financeiras e a estratégia de geração das recorrências estão documentadas em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

---

## Segurança

* Todas as tabelas usam **RLS** com políticas `auth.uid() = usuario_id`.
* O usuário é sempre obtido no servidor (`supabase.auth.getUser()`); o `usuario_id` enviado pelo navegador nunca é usado.
* As chaves estrangeiras compostas com `usuario_id` impedem que uma linha aponte para dados de outro usuário.
* As operações que alteram várias linhas rodam em funções PostgreSQL `SECURITY INVOKER`, em uma única transação.
* As funções não podem ser executadas por usuários anônimos, e as tabelas novas não concedem `TRUNCATE`.

---

## Como Executar o Projeto

### Pré-requisitos

* Node.js e npm
* Uma conta no Supabase
* OAuth do Google configurado no Supabase

### 1. Clone e instale

```bash
git clone https://github.com/seu-usuario/finance-app.git
cd finance-app
npm install
```

### 2. Configure as variáveis de ambiente

Crie o arquivo `.env.local` na raiz:

```env
NEXT_PUBLIC_SUPABASE_URL=sua_url_do_supabase
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sua_chave_publishable
```

> O arquivo `.env.local` não deve ser enviado para o GitHub.

### 3. Aplique as migrations do banco

As migrations ficam em `supabase/migrations/` e devem ser aplicadas **em ordem**:

1. `20261118120000_fase1_pagamento_e_rpcs_parcelamento.sql`
2. `20261119090000_fase2_recorrencias.sql`
3. `20261119120000_fase3_cartoes_faturas.sql`

Pelo SQL Editor do Supabase, cole cada arquivo entre `BEGIN;` e `COMMIT;`. Elas verificam o esquema antes de alterar qualquer coisa, abortam se algo divergir, podem ser executadas mais de uma vez e não alteram dados existentes. O script `supabase/diagnostico_esquema.sql` (somente leitura) ajuda a conferir o banco antes.

### 4. Execute

```bash
npm run dev
```

A aplicação fica disponível em `http://localhost:3000`.

---

## Testes

```bash
npm test        # testes unitários e de banco
npm run lint
npm run build
```

* **Unitários:** centavos, datas, recorrências, ciclo de fatura, limite do cartão e indicadores do painel (incluindo a ausência de contagem dupla entre compras e pagamento de fatura).
* **Banco:** as migrations são aplicadas sobre um PostgreSQL real em WASM, com o esquema espelhado do Supabase. Os testes verificam:
  - RLS e isolamento entre usuários;
  - operações atômicas;
  - geração de recorrências sem duplicidade;
  - compras antes e depois do fechamento;
  - pagamento parcial e total de faturas;
  - paridade do cálculo de fatura entre SQL e TypeScript.

---

## Deploy

O projeto é publicado na **Vercel** a partir do GitHub (cada push na `main` gera um deploy). As variáveis `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` devem estar configuradas no projeto da Vercel, e o domínio da aplicação deve constar nas URLs permitidas do Supabase Auth.

O código tolera banco com migrations ainda não aplicadas: as funcionalidades novas avisam que a migration está pendente, e o resto continua funcionando.

---

## Estrutura do Projeto

```text
finance-app/
├── app/
│   ├── (app)/                  telas autenticadas (layout com navegação)
│   │   ├── page.tsx            painel
│   │   ├── recorrencias/
│   │   ├── parcelamentos/
│   │   └── cartoes/
│   ├── auth/callback/route.ts
│   ├── login/page.tsx
│   ├── components/             formulários, diálogos, navegação, avisos
│   ├── lib/                    regras puras: money, datas, meses,
│   │                           recorrencias, cartoes, parcelamentos, painel
│   ├── actions.ts              Server Actions
│   └── layout.tsx
├── docs/ARQUITETURA.md
├── supabase/
│   ├── migrations/
│   └── diagnostico_esquema.sql
├── tests/                      unitários + tests/sql (PGlite)
├── proxy.ts                    proteção das rotas autenticadas
└── README.md
```

---

## Objetivo do Projeto

O FinanceApp foi desenvolvido como projeto acadêmico no curso de **Engenharia de Software da Unicatólica-TO**, buscando aplicar conceitos de desenvolvimento web moderno, componentes, banco de dados relacional, autenticação, segurança de dados, Server Actions, controle de acesso, testes automatizados, desenvolvimento responsivo e deploy em produção.

---

## Status

* [x] Login com Google e Supabase Auth
* [x] Receitas, despesas e categorias
* [x] Navegação entre meses
* [x] Parcelamentos com valor exato e gerenciamento completo
* [x] Controle de pagamento
* [x] Contas recorrentes
* [x] Cartões de crédito, faturas e pagamento de fatura
* [x] Painel com disponível, a pagar, vencimentos e compromissos
* [x] Row Level Security e isolamento por usuário
* [x] Interface responsiva com tema claro e escuro
* [x] Testes automatizados (unitários e de banco)
* [ ] Valor estimado x valor realizado

---

<p align="center">
  Desenvolvido como projeto acadêmico de Engenharia de Software.
</p>
