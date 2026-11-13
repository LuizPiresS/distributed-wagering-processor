# Task 02: Modelo de Domínio Puro (DDD)

## 1. Objetivo
Implementar o núcleo de domínio do processador financeiro seguindo **Domain-Driven Design (DDD)** puro, encapsulando regras de negócio e invariantes em entidades e objetos de valor, sem dependências de decorators do NestJS ou tipos específicos do ORM.

---

## 2. Requisitos Cobertos
- **Seção 6.0:** Construtores `private`/`protected` + factories estáticas (`create`, `from`, `rehydrate`).
- **Seção 6.1:** Value Object `Money` imutável, baseado em `decimal.js` / `big.js`, escala fixa de 2 casas, suporte a validações de moeda (ISO-4217).
- **Seção 6.2:** Aggregate Root `Wallet` com controle de versão, invariante de saldo não-negativo, unicidade conceitual por player e moeda.
- **Seção 6.3:** Entidade `WagerTransaction` com máquina de estados rigorosa (`PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, `FAILED`).
- **Seção 6.4:** Entidade imutável `WalletLedgerEntry` com validação de consistência aritmética (`isBalanced`).
- **Seção 6.5:** Entidades `InboxMessage` e `OutboxMessage`.
- **Seção 11:** Envelope abstrato `IntegrationEvent<T>` e eventos concretos tipados.

---

## 3. Detalhamento Técnico

### 3.1 Value Object `Money`
- **Biblioteca base:** `decimal.js` (ou `big.js`) encapsulada estritamente dentro da classe.
- **Estrutura interna:**
  ```ts
  export interface MoneyProps {
    readonly amount: string;   // Ex: "25.00" (sempre 2 casas)
    readonly currency: string; // Ex: "BRL"
  }

  export class Money {
    private constructor(
      private readonly value: Decimal,
      public readonly currency: string,
    ) {}

    static from(props: MoneyProps): Money;
    static zero(currency: string): Money;
    static fromDecimal(value: Decimal, currency: string): Money;

    add(other: Money): Money;
    subtract(other: Money): Money;
    negate(): Money;

    isZero(): boolean;
    isPositive(): boolean;
    isNegative(): boolean;
    isLessThan(other: Money): boolean;
    isGreaterThan(other: Money): boolean;
    equals(other: Money): boolean;

    toJSON(): MoneyProps;
    toString(): string; // Sempre string decimal com 2 casas: "25.00"

    private assertSameCurrency(other: Money): void;
  }
  ```
- **Regras de Validação no `Money.from`:**
  - Rejeitar strings vazias, `NaN`, `Infinity`, valores em notação científica (ex: `1e5`).
  - Rejeitar mais ou menos de 2 casas decimais no formato de entrada (exigir regex: `^-?\d+\.\d{2}$`).
  - Rejeitar moedas inválidas ou diferentes em operações aritméticas (`CurrencyMismatchError`).

---

### 3.2 Aggregate Root `Wallet`
- **Atributos:**
  - `id`: string (UUID v7 recomendado para ordenação temporal).
  - `playerId`: string (UUID).
  - `currency`: string (ISO-4217, ex: "BRL").
  - `_balance`: `Money`.
  - `_version`: number (inicia em 1, incrementa a cada mutação de saldo).
  - `createdAt`: Date.
  - `_updatedAt`: Date.
- **Comportamentos:**
  - `static open(props: { id: string; playerId: string; initialBalance: Money }): Wallet`
  - `static rehydrate(state: WalletState): Wallet`
  - `debit(money: Money): { newBalance: Money; previousBalance: Money }`:
    - Verifica moeda.
    - Se `_balance.isLessThan(money)`, lança `InsufficientFundsError`.
    - Atualiza `_balance = _balance.subtract(money)`.
    - Incrementa `_version++`.
  - `credit(money: Money): { newBalance: Money; previousBalance: Money }`:
    - Verifica moeda.
    - Atualiza `_balance = _balance.add(money)`.
    - Incrementa `_version++`.

---

### 3.3 Entidade `WalletLedgerEntry`
- **Imutabilidade total:** Sem setters, sem métodos mutadores.
- **Atributos:** `id`, `walletId`, `transactionId`, `direction` (`DEBIT` | `CREDIT`), `money`, `balanceBefore`, `balanceAfter`, `createdAt`.
- **Validação na factory `create`:**
  ```ts
  isBalanced(): boolean {
    if (this.direction === LedgerDirection.Credit) {
      return this.balanceBefore.add(this.money).equals(this.balanceAfter);
    }
    return this.balanceBefore.subtract(this.money).equals(this.balanceAfter);
  }
  ```
  Se `!isBalanced()`, lança `UnbalancedLedgerEntryError`.

---

### 3.4 Entidade `WagerTransaction` & Máquina de Estados
- **Tipos de Operação (`WagerTransactionKind`):**
  - `OPENING`: Crédito inicial interno na abertura da wallet.
  - `BET`: Débito de aposta.
  - `WIN`: Crédito de prêmio da rodada.
  - `LOSS`: Resultado sem movimentação financeira.
  - `REFUND`: Reversão de aposta (`BET`).
  - `ROLLBACK`: Reversão geral de `BET`, `WIN` ou `REFUND`.
- **Estados (`WagerTransactionStatus`):**
  - `PENDING`: Aguardando processamento.
  - `PENDING_REFERENCE`: Aguardando transação original referenciada.
  - `PROCESSED`: Concluída com sucesso (Terminal).
  - `REJECTED`: Rejeitada por regra de negócio (Terminal).
  - `FAILED`: Falha irrecuperável de sistema (Terminal).
- **Invariantes de Transição:**
  - Transições a partir de estados terminais lançam `InvalidTransactionStateError`.
  - `REFUND` e `ROLLBACK` exigem `referenceExternalTransactionId` obrigatoriamente.
  - Validação de correspondência de hash (`matchesPayload(hash)`).

---

### 3.5 Hierarquia de Eventos de Integração (`IntegrationEvent<T>`)
- Classe abstrata com envelope:
  - `eventId`: UUID v7.
  - `aggregateId`: ID da wallet ou da transação.
  - `correlationId`: ID de rastreabilidade.
  - `causationId`: ID da mensagem/transação causadora.
  - `occurredAt`: Date.
  - `eventType`: string tipada por subclasse.
  - `version`: number.
  - `data`: payload contendo `MoneyProps` serializado (nunca instância viva de `Money`).
- **Eventos obrigatórios:**
  - `WalletBalanceChanged`
  - `WagerTransactionProcessed`
  - `WagerTransactionRejected`
  - `WagerTransactionPendingReference`

---

### 3.6 Taxonomia de Códigos de Falha (`FailureCode`)
Definição de enum estável e legível por máquina:
- `INSUFFICIENT_FUNDS`: Saldo insuficiente para efetuar débito de aposta.
- `ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE`: Reversão impedida pois deixaria saldo negativo (código distinto de aposta comum, conforme Seção 7 regra 9).
- `REFERENCE_NOT_FOUND`: Referência não encontrada após expiração de retries.
- `REFERENCE_ALREADY_REVERSED`: Operação referenciada já foi revertida anteriormente.
- `INVALID_REFERENCE_OPERATION`: Tipo de operação referenciada incompatível com o tipo de reversão.
- `CURRENCY_MISMATCH`: Moeda da transação incompatível com a carteira ou com a referência.
- `PLAYER_MISMATCH`: Player da transação incompatível com a carteira.
- `AMOUNT_MISMATCH`: Valor de reversão diferente do valor original.
- `IDEMPOTENCY_PAYLOAD_CONFLICT`: Mesma chave de idempotência com payload divergente.

---

## 4. Checklist de Implementação
- [ ] Implementar classe `Money` com cobertura de 100% dos métodos e operadores.
- [ ] Implementar `Wallet` com factory estática `open` e `rehydrate`.
- [ ] Implementar `WalletLedgerEntry` com validação de `isBalanced()`.
- [ ] Implementar `WagerTransaction` e transições de estado blindadas.
- [ ] Implementar classes de eventos de integração com envelope JSON canônico.
- [ ] Implementar testes unitários exaustivos para todas as classes de domínio.

---

## 5. Critérios de Aceite
- [ ] Nenhuma dependência externa ou do framework NestJS importada dentro do diretório `src/domain`.
- [ ] Impossível instanciar `Money` com tipos primitivos flutuantes ou decimais malformados.
- [ ] Transições de estado inválidas em `WagerTransaction` são bloqueadas em runtime.

