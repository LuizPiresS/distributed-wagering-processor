# Task 04: Motor de Idempotência e Caso de Uso Transacional

## 1. Objetivo
Desenvolver o caso de uso principal do sistema (`ProcessWagerTransactionUseCase`), integrando o motor de idempotência baseado em hash canônico SHA-256 e aplicando a estratégia de controle de concorrência por lock pessimista na carteira (`walletId`), garantindo a execução atômica de débitos, créditos, reversões e emissão de eventos.

---

## 2. Requisitos Cobertos
- **Seção 5 (Restrições Invioláveis):** Sem lock global; sem `read → calculate → update` ingênuo; persistência de idempotência no banco; transação atômica.
- **Seção 7 (Regras de Negócio):** Regras de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`; resolução de referências; tratamento de referências ausentes (`PENDING_REFERENCE`).
- **Seção 8 (Concorrência e Ordenação):** Unidade de concorrência restrita a `walletId`; isolamento para múltiplos nós concorrentes; suporte ao cenário de duas apostas disputando saldo.
- **Seção 9 (Idempotência Canônica):** Hashing SHA-256 sobre JSON canônico com chaves ordenadas; distinção entre *idempotent replay* e *payload conflict*.

---

## 3. Detalhamento Técnico

### 3.1 Algoritmo de Hashing Canônico (JSON Canonicalization)
Para garantir que variações na ordem dos atributos JSON ou espaços em branco não alterem o hash:
```ts
export function createCanonicalPayloadHash(data: Record<string, unknown>): string {
  // 1. Filtrar apenas campos de negócio (remover metadados de transporte e headers)
  const businessPayload = {
    providerId: data.providerId,
    externalTransactionId: data.externalTransactionId,
    playerId: data.playerId,
    walletId: data.walletId,
    roundId: data.roundId,
    gameId: data.gameId,
    kind: data.kind,
    amount: data.money.amount,
    currency: data.money.currency,
    referenceExternalTransactionId: data.referenceExternalTransactionId ?? null,
  };

  // 2. Serializar recursivamente com ordenação de chaves
  const canonicalJson = canonicalStringify(businessPayload);

  // 3. Gerar SHA-256
  return crypto.createHash("sha256").update(canonicalJson).digest("hex");
}
```

### 3.2 Fluxo Transacional do Caso de Uso (`ProcessWagerTransactionUseCase`)

```
                          [ Início da Transação SQL ]
                                      │
                                      ▼
                        Existe WagerTransaction com
                         mesma `idempotencyKey`?
                                 /         \
                             SIM             NÃO
                             /                 \
            PayloadHash coincide?               │
               /             \                  │
            SIM               NÃO               │
            /                   \               │
   Retorna Estado Original   Lança Erro         │
   com `idempotentReplay: true`  409 Conflict   │
                                                │
                                                ▼
                             [ SELECT ... FOR UPDATE ]
                             na Wallet pelo `walletId`
                                                │
                     ┌──────────────────────────┴──────────────────────────┐
                     ▼                                                     ▼
              Aposta / Ganho                                         Reversão
             (`BET`, `WIN`, `LOSS`)                             (`REFUND`, `ROLLBACK`)
                     │                                                     │
                     │                                            Busca Referência Original
                     │                                           (providerId, refExternalId)
                     │                                                     │
                     │                                            Encontrada no banco?
                     │                                            /                  \
                     │                                          SIM                  NÃO
                     │                                          /                      \
                     │                                 Referência já revertida?     Persiste como
                     │                                 /                  \       `PENDING_REFERENCE`
                     │                               SIM                  NÃO       (Agendado para
                     │                               /                      \          worker)
                     │                       Rejeita com                   Aplica
                     │                 `REFERENCE_ALREADY_REVERSED`       Reversão
                     │                                                      │
                     └──────────────────────────┬───────────────────────────┘
                                                │
                                                ▼
                         Atualiza Saldo da Wallet + Versão
                                                │
                                                ▼
                        Registra Entrada no Ledger (Append-Only)
                                                │
                                                ▼
                        Persiste WagerTransaction (`PROCESSED`)
                                                │
                                                ▼
                        Insere Mensagem na Tabela `outbox_messages`
                                                │
                                                ▼
                                    [ COMMIT Transação SQL ]
                                                │
                                                ▼
                               Retorna Resultado ao Chamador
```

### 3.3 Regras Específicas por Tipo de Operação

1. **`BET` (Aposta):**
   - Valida se `wallet.balance >= transaction.money`.
   - Se insuficiente: cria `WagerTransaction` como `REJECTED` (`failureCode: 'INSUFFICIENT_FUNDS'`), insere evento de outbox `WagerTransactionRejected`. **Nenhum lançamento no ledger é gerado.**
   - Se suficiente: `wallet.debit(money)`, cria 1 lançamento `DEBIT` no ledger, marca `PROCESSED`, insere evento `WagerTransactionProcessed` e `WalletBalanceChanged`.

2. **`WIN` (Ganho):**
   - Se houver `referenceExternalTransactionId`, valida se pertence à mesma rodada (`roundId`).
   - `wallet.credit(money)`, cria 1 lançamento `CREDIT` no ledger, marca `PROCESSED`, emite eventos.

3. **`LOSS` (Perda):**
   - Não movimenta saldo (`affectsBalance() === false`).
   - Não gera registro no ledger.
   - Marca `PROCESSED` e registra auditoria.

4. **`REFUND` (Estorno de Aposta):**
   - Exige referência a uma `BET` que esteja em estado `PROCESSED`.
   - Valida se os valores são idênticos (`money.equals(reference.money)`).
   - Valida se a transação referenciada já não foi estornada anteriormente.
   - `wallet.credit(money)`, cria 1 lançamento `CREDIT` no ledger, marca `PROCESSED`.

5. **`ROLLBACK` (Reversão Geral):**
   - Pode reverter `BET`, `WIN` ou `REFUND` que estejam `PROCESSED`.
   - Aplica a movimentação inversa (reversão de crédito vira débito; reversão de débito vira crédito).
   - **Guarda contra saldo negativo:** se a reversão for de um crédito (`WIN`) e o saldo atual for inferior ao valor a ser estornado:
     - Não permite saldo negativo!
     - Marca a transação como `REJECTED` com `failureCode: 'ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE'`.
     - Nenhum movimento de saldo ou ledger é executado.

6. **Referências Ausentes (Fora de Ordem):**
   - Se a transação referenciada ainda não estiver no banco (devido a entrega assíncrona fora de ordem):
     - A transação é salva como `PENDING_REFERENCE`.
     - Nenhum saldo é alterado de imediato.
     - Um evento `WagerTransactionPendingReference` é enfileirado na outbox.

---

## 4. Checklist de Implementação
- [ ] Implementar utilitário `canonicalJsonHash` com algoritmo de ordenação estável.
- [ ] Implementar `ProcessWagerTransactionUseCase` encapsulando a transação do MikroORM.
- [ ] Adicionar lock pessimista `em.findOne(Wallet, walletId, { lockMode: LockMode.PESSIMISTIC_WRITE })`.
- [ ] Implementar as verificações completas de idempotência (mesmo payload vs payload divergente).
- [ ] Implementar as regras de reversão de `REFUND` e `ROLLBACK` com prevenção de dupla reversão.
- [ ] Criar testes unitários e de integração mockando concorrência no caso de uso.

---

## 5. Critérios de Aceite
- [ ] Submeter 2 requisições com a mesma `idempotencyKey` e mesmo payload retorna o resultado original sem duplicar lançamentos no ledger (`idempotentReplay: true`).
- [ ] Submeter a mesma `idempotencyKey` com payload alterado falha com erro de conflito (`409 Conflict`).
- [ ] Submeter duas apostas simultâneas de R$ 80,00 sobre saldo de R$ 100,00 resulta em 1 sucesso (saldo 20,00) e 1 rejeição por saldo insuficiente.
- [ ] Nenhuma transação financeira publica eventos antes do commit do banco de dados.

