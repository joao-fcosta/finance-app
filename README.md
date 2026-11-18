# <p align="center">FinanceApp</p>

<p align="center">
  <strong>Controle Financeiro Pessoal</strong><br>
  Engenharia de Software | Unicatólica-TO
</p>

---

## Sobre

O **FinanceApp** é uma aplicação web progressiva (PWA) voltada para controle financeiro pessoal, desenvolvida com foco em **simplicidade, praticidade e segurança**.

A aplicação permite gerenciar rendas e despesas, organizar gastos por categorias, acompanhar o saldo mensal e controlar compras parceladas.

O sistema utiliza autenticação via Google e armazenamento de dados no **Supabase**, permitindo que cada usuário tenha seus próprios dados financeiros de forma isolada.

---

## Principais Funcionalidades

**Controle de receitas e despesas:**
Cadastre rendas e contas, informando nome, valor, categoria e mês de referência.

**Categorias financeiras:**
As despesas podem ser organizadas em:

* Necessidades (50%)
* Estilo de Vida (30%)
* Projetos e Poupança (20%)

**Gerenciamento de parcelas:**
Compras parceladas são distribuídas automaticamente entre os meses, identificadas como `1/12`, `2/12`, `3/12` etc.
O valor é dividido em centavos inteiros: os centavos excedentes ficam nas primeiras parcelas (R$ 100,00 em 3x → R$ 33,34 + R$ 33,33 + R$ 33,33), e a soma é sempre igual ao total.

A tela **Parcelamentos** (`/parcelamentos`) separa os parcelamentos ativos dos finalizados e mostra, para cada um, o valor total, o valor da parcela, as parcelas pagas e pendentes, o valor restante, a próxima parcela e o progresso. Ao abrir um parcelamento, as parcelas aparecem uma a uma, organizadas por mês.

**Controle de pagamento:**
Cada parcela pode ser marcada como paga (com data de pagamento registrada) ou ter o pagamento desfeito, mediante confirmação. Uma parcela pendente cujo mês já terminou aparece como **vencida**. Registros anteriores a esse controle aparecem como **sem status**: o sistema não presume que foram pagos.

**Edição e exclusão de parcelas:**
- *Somente esta parcela:* altera apenas a parcela escolhida.
- *Esta e as próximas:* altera a parcela e as seguintes, preservando as que já foram pagas. Pede confirmação antes de executar.
- *Excluir somente esta parcela:* permitido para parcelas não pagas.
- *Excluir o parcelamento inteiro:* remove todas as parcelas, após confirmação.

Essas operações rodam como funções no PostgreSQL (RPC), em uma única transação.

**Edição de transações:**
Permite alterar informações de transações já cadastradas, como nome, valor, categoria e mês de referência.

**Navegação mensal:**
Consulte suas receitas, despesas e saldo de diferentes meses.

**Modo Escuro:**
Interface compatível com tema claro e escuro.

**Mobile First:**
Interface desenvolvida pensando principalmente em dispositivos móveis, mantendo adaptação para telas maiores.

**Autenticação com Google:**
Login realizado através do Google OAuth.

**Privacidade e isolamento dos dados:**
Cada usuário possui seus próprios registros financeiros. O Supabase Row Level Security (RLS) garante que um usuário não tenha acesso aos dados financeiros de outro usuário.

---

## Tecnologias Utilizadas

### Front-end

* **Next.js**
* **React**
* **TypeScript**
* **Tailwind CSS**

### Back-end

* **Next.js Server Actions**
* **Supabase**
* **PostgreSQL**

### Autenticação

* **Supabase Auth**
* **Google OAuth 2.0**

### Segurança

* **Row Level Security (RLS)**
* Políticas baseadas no usuário autenticado através de `auth.uid()`

### Testes

```bash
npm test
```

Os testes unitários (Vitest) cobrem a distribuição de parcelas em centavos, a aritmética de meses, a máscara monetária e o resumo dos parcelamentos (pagas, pendentes, vencidas, restante, próxima parcela e registros antigos).

---

## Deploy

* **Vercel**

---

## Banco de Dados

O FinanceApp utiliza o Supabase como banco de dados PostgreSQL.

Principais tabelas:

```text
┌──────────────────┐
│     auth.users   │
│──────────────────│
│ id               │
│ email            │
│ ...              │
└────────┬─────────┘
         │
         │ usuario_id
         │
    ┌────▼──────────────┐
    │   parcelamentos   │
    │───────────────────│
    │ id                │
    │ usuario_id        │
    │ nome              │
    │ total_parcelas    │
    │ valor_total       │
    └────────┬──────────┘
             │
             │ parcelamento_id
             │
    ┌────────▼──────────┐
    │    transacoes     │
    │───────────────────│
    │ id                │
    │ usuario_id        │
    │ nome              │
    │ mes_referencia    │
    │ valor_estimado    │
    │ valor_real        │
    │ tipo              │
    │ categoria_id      │
    │ parcelamento_id   │
    │ numero_parcela    │
    │ status_pagamento  │
    │ pago_em           │
    └───────────────────┘
```

As categorias financeiras são armazenadas na tabela:

```text
categorias
```

---

## Segurança

O sistema utiliza **Row Level Security (RLS)** no Supabase.

As transações e parcelamentos possuem um `usuario_id` relacionado ao usuário autenticado.

As operações são protegidas por políticas que verificam:

```sql
auth.uid() = usuario_id
```

Dessa forma, cada usuário pode acessar e modificar somente seus próprios dados.

O identificador do usuário também é obtido no servidor através da sessão autenticada, evitando confiar em um `usuario_id` enviado pelo navegador.

---

## Como Executar o Projeto

### Pré-requisitos

* Node.js
* npm
* Uma conta no Supabase
* Um projeto no Google Cloud
* OAuth do Google configurado no Supabase

---

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/finance-app.git
```

Entre na pasta:

```bash
cd finance-app
```

---

### 2. Instale as dependências

```bash
npm install
```

---

### 3. Configure as variáveis de ambiente

Crie um arquivo:

```text
.env.local
```

Na raiz do projeto:

```env
NEXT_PUBLIC_SUPABASE_URL=sua_url_do_supabase
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sua_chave_publishable
```

> O arquivo `.env.local` não deve ser enviado para o GitHub.

---

### 4. Aplique as migrations do banco

As migrations ficam em `supabase/migrations/`. Antes de aplicá-las, rode `supabase/diagnostico_esquema.sql` no SQL Editor (somente leitura) e confira o esquema.

```bash
supabase db push
```

Ou cole o conteúdo de cada migration, em ordem, no SQL Editor do Supabase.

A migration da FASE 1 verifica o esquema antes de alterar qualquer coisa e aborta se encontrar divergências. Ela não remove colunas nem altera políticas de RLS. As instruções de rollback estão no final do arquivo.

---

### 5. Execute o projeto

```bash
npm run dev
```

A aplicação ficará disponível em:

```text
http://localhost:3000
```

---

## Deploy

O projeto pode ser publicado utilizando a **Vercel**.

Fluxo recomendado:

```text
GitHub
   ↓
Vercel
   ↓
Next.js
   ↓
Supabase
```

As variáveis de ambiente utilizadas localmente também devem ser configuradas no projeto da Vercel:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Após o deploy, o domínio da aplicação deve ser configurado nas URLs permitidas do Supabase Auth para que o login com Google funcione corretamente.

---

## Estrutura do Projeto

**Root Path:**

```text
C:\Projeto\finance-app
```

```text
finance-app/
│
├── 📁 app/
│   │
│   ├── 📁 auth/
│   │   └── 📁 callback/
│   │       └── 📄 route.ts
│   │
│   ├── 📁 components/
│   │   ├── 📄 TransactionModal.tsx
│   │   ├── 📄 ConfirmDialog.tsx
│   │   ├── 📄 Toast.tsx
│   │   ├── 📄 Icon.tsx
│   │   ├── 📄 BadgeSituacao.tsx
│   │   └── 📄 useOperacoesTransacao.tsx
│   │
│   ├── 📁 lib/
│   │   ├── 📄 supabase.ts
│   │   ├── 📄 money.ts
│   │   ├── 📄 meses.ts
│   │   ├── 📄 parcelamentos.ts
│   │   └── 📄 types.ts
│   │
│   ├── 📁 parcelamentos/
│   │   └── 📄 page.tsx
│   │
│   ├── 📁 login/
│   │   └── 📄 page.tsx
│   │
│   ├── 📄 actions.ts
│   ├── 📄 favicon.ico
│   ├── 🎨 globals.css
│   ├── 📄 layout.tsx
│   └── 📄 page.tsx
│
├── 📁 supabase/
│   ├── 📁 migrations/
│   └── 📄 diagnostico_esquema.sql
│
├── 📁 tests/
│
├── 📄 proxy.ts
├── 📄 .env.local
├── 📄 package.json
├── 📄 tsconfig.json
└── 📄 README.md
```

---

## Fluxo da Aplicação

```text
                    ┌──────────────┐
                    │ Google Login │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ Supabase Auth│
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   FinanceApp │
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       ┌──────────────┐          ┌──────────────┐
       │  Receitas    │          │   Despesas   │
       └──────────────┘          └──────┬───────┘
                                        │
                                ┌───────▼────────┐
                                │   Categorias   │
                                └────────────────┘
                                        │
                                ┌───────▼────────┐
                                │  Parcelamentos │
                                └────────────────┘
```

---

## Objetivo do Projeto

O FinanceApp foi desenvolvido como projeto acadêmico no curso de **Engenharia de Software da Unicatólica-TO**, buscando aplicar conceitos de:

* Desenvolvimento web moderno
* Desenvolvimento orientado a componentes
* Banco de dados relacional
* Autenticação de usuários
* Segurança de dados
* Server Actions
* Controle de acesso
* Desenvolvimento responsivo
* Deploy em ambiente de produção

---

## Status

🚧 **Em desenvolvimento**

Funcionalidades atuais:

* [x] Login com Google
* [x] Autenticação via Supabase
* [x] Cadastro de receitas
* [x] Cadastro de despesas
* [x] Categorias
* [x] Navegação entre meses
* [x] Parcelamentos
* [x] Exclusão de transações
* [x] Edição de transações
* [x] Row Level Security
* [x] Interface responsiva
* [ ] Valor estimado x valor realizado
* [x] Melhorias no gerenciamento de parcelamentos
* [x] Controle de pagamento de parcelas
* [ ] Deploy em produção

---

<p align="center">
  Desenvolvido como projeto acadêmico de Engenharia de Software.
</p>
