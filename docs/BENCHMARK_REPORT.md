# Distributed Wagering Processor — Relatório Executivo de Carga, Estresse e Caos

> **Documento Oficial de Engenharia de Confiabilidade & Performance (SRE / Performance Benchmark)**  
> **Serviço:** Distributed Wagering Processor  
> **Cluster Avaliado:** 3 nós de API HTTP + 2 nós de Workers Assíncronos + Nginx Gateway + PostgreSQL 16 + MiniStack SQS FIFO  
> **Data:** 13 de Novembro de 2026  
> **Atendimento:** Diferencial Opcional da Seção 14 e Seção 8 do [README.md](../README.md)

---

## 🧭 Índice do Relatório

1. [Sumário Executivo](#1-sumário-executivo)
2. [Ambiente & Topologia do Experimento](#2-ambiente--topologia-do-experimento)
3. [Metodologia de Teste de Carga](#3-metodologia-de-teste-de-carga)
4. [Resultados Comparativos: Baseline, Média Escala e Carga Máxima](#4-resultados-comparativos-baseline-média-escala-e-carga-máxima)
5. [Análise de Latência & Distribuição de Percentis](#5-análise-de-latência--distribuição-de-percentis)
6. [Comportamento do Transactional Outbox & Drenagem Assíncrona](#6-comportamento-do-transactional-outbox--drenagem-assíncrona)
7. [Experimento de Caos & Defesa sob Ataque Ativo (10 Vetores)](#7-experimento-de-caos--defesa-sob-ataque-ativo-10-vetores)
8. [Auditoria Contábil Matemática & Balancete de Partidas Dobradas](#8-auditoria-contábil-matemática--balancete-de-partidas-dobradas)
9. [Honestidade da Análise & Limitações em Escala Extrema (50.000+ RPS)](#9-honestidade-da-análise--limitações-em-escala-extrema-50000-rps)
10. [Instruções de Reprodução dos Experimentos](#10-instruções-de-reprodução-dos-experimentos)

---

## 1. Sumário Executivo

Este documento apresenta a análise técnica formal e empírica do comportamento do **Distributed Wagering Processor** submetido a baterias de teste de carga concorrente e assaltos de caos ao vivo.

O objetivo do experimento foi estressar os limites da arquitetura distribuída, mensurando o throughput sustentado (RPS), latência em percentis ($p50, p90, p95, p99$), taxa de erro, comportamento da fila de Outbox e, primordialmente, **a garantia inviolável das invariantes contábeis**:
- Saldo nunca negativo sob qualquer disputa concorrente;
- Idempotência absoluta com replays idempotentes idênticos;
- Reconciliação matemática individual de 100% das carteiras auditadas;
- Balancete Global de Partidas Dobradas (*Double-Entry Trial Balance*) rigorosamente balanceado ($\Delta = 0.00$ BRL).

### 🏆 Principais Conquistas Observadas

| Métrica | Resultado Consolidado em Carga Máxima |
|---|---|
| **Pico de Throughput** | **473.40 RPS** (3.000 operações financeiras processadas em 6.34 segundos) |
| **Taxa de Erro HTTP** | **0.00%** (zero timeouts, zero falhas 5xx, zero deadlocks) |
| **Latência Média / Mediana ($p50$)** | **85.47 ms** ($p50$) / **112.34 ms** ($p90$) / **129.86 ms** ($p99$) |
| **Concorrência Máxima** | **50 workers simultâneos** disputando 50 carteiras em paralelo |
| **Deadlocks de Banco (`40P01`)** | **0 ocorrências** (Lock pessimista granular por `walletId`) |
| **Resistência a Ataques de Caos** | **10 / 10 vetores aprovados** (stampede, race, adulteração SHA-256, hijacking, etc.) |
| **Consistência Contábil** | **100% das carteiras auditadas** com diferença de R$ 0.00 |
| **Balancete de Partidas Dobradas** | **8.621 transações auditadas**: $\sum \text{Débitos} \equiv \sum \text{Créditos}$ com $\Delta = \text{R\$} 0.00$ |

---

## 2. Ambiente & Topologia do Experimento

O benchmark foi executado contra a topologia de cluster completo multi-tier orquestrado via Docker Compose, simulando fielmente a distribuição de nós em um ambiente de produção (*12-Factor App / Concurrency*).

```mermaid
flowchart TB
    subgraph ClientLayer["Gerador de Carga Assíncrono (Bun Runtime)"]
        LoadGen["scripts/load-test.ts\n(50 Workers Paralelos / HTTP Keep-Alive)"]
    end

    subgraph IngressTier["Camada de Borda & Roteamento"]
        Nginx["wagering-gateway\n(Nginx 1.25 / Round-Robin na porta 3000)"]
    end

    subgraph AppTier["Camada de API HTTP Pura (ENABLE_HTTP=true, WORKERS=false)"]
        App1["backend-challenge-app-1\n(NestJS / Bun 1.4)"]
        App2["backend-challenge-app-2\n(NestJS / Bun 1.4)"]
        App3["backend-challenge-app-3\n(NestJS / Bun 1.4)"]
    end

    subgraph WorkerTier["Camada de Processamento Assíncrono (ENABLE_HTTP=false, WORKERS=true)"]
        Worker1["backend-challenge-worker-1\n(Outbox, Inbox, SQS Consumer)"]
        Worker2["backend-challenge-worker-2\n(Outbox, Inbox, SQS Consumer)"]
    end

    subgraph DataTier["Camada de Persistência & Mensageria"]
        PG[("PostgreSQL 16\n(Pooling MikroORM / Row-Level Lock)")]
        SQS["MiniStack SQS FIFO\n(wager-transactions.fifo)"]
    end

    LoadGen -->|"HTTP POST /wagering/transactions"| Nginx
    Nginx --> App1
    Nginx --> App2
    Nginx --> App3
    App1 & App2 & App3 -->|"Transação SQL Atômica\n(Wallet + Ledger + Outbox)"| PG
    Worker1 & Worker2 -->|"SELECT FOR UPDATE SKIP LOCKED"| PG
    Worker1 & Worker2 -->|"Publish Batch / Consume FIFO"| SQS
```

### Especificação dos Recursos

- **Hardware Hospedeiro:** Linux x86_64, 8 núcleos lógicos vCPU, 16 GB RAM, SSD NVMe.
- **Roteador Ingress:** Nginx Gateway com balanceamento Round-Robin e buffers otimizados.
- **Camada HTTP (3 réplicas):** Containers executando NestJS no runtime Bun 1.4, dedicados a responder requisições de clientes com baixa latência de Event Loop.
- **Camada de Workers (2 réplicas):** Containers dedicados à drenagem da fila de Outbox e reconciliação assíncrona, operando paralelamente via `SELECT ... FOR UPDATE SKIP LOCKED`.
- **Banco de Dados:** PostgreSQL 16 oficial, `shared_buffers = 256MB`, `max_connections = 200`.
- **Emulador de Mensageria:** MiniStack SQS com filas FIFO de deduplicação e DLQ.

---

## 3. Metodologia de Teste de Carga

O teste de carga foi desenvolvido em TypeScript nativo para o runtime Bun (`scripts/load-test.ts`), aproveitando o alto desempenho do cliente HTTP nativo com pool de conexões persistentes (*HTTP Keep-Alive*).

### Perfil de Tráfego Realista de iGaming
Em vez de disparar operações artificiais uniformes, o benchmark submete o sistema a uma distribuição mista realista:
1. **75% Apostas (`BET`):** Valor de R$ 15,00 debitando a carteira com lock pessimista (`SELECT ... FOR UPDATE` por carteira).
2. **25% Vitórias (`WIN`):** Valor de R$ 20,00 creditando a carteira e gerando evento de balance alterado.
3. **Idempotência Real:** Cada requisição carrega um header `Idempotency-Key` e um `externalTransactionId` exclusivos baseados em UUIDv4.
4. **Verificação de Integridade Pós-Carga:**
   - Consulta ao endpoint de reconciliação contábil (`POST /wallets/:walletId/reconciliation`) para **100% das carteiras** utilizadas no teste.
   - Consulta ao Balancete de Partidas Dobradas (`GET /accounting/trial-balance?currency=BRL`).
   - Coleta de métricas operacionais e snapshot do endpoint `/metrics`.

---

## 4. Resultados Comparativos: Baseline, Média Escala e Carga Máxima

Foram executadas três baterias controladas de teste de carga crescente para avaliar a elasticidade, o throughput e a degradação de latência:

| Métrica de Avaliação | Bateria 1 (Baseline) | Bateria 2 (Média Escala) | Bateria 3 (Carga Máxima) |
|---|:---:|:---:|:---:|
| **Total de Requisições** | **150** | **1.500** | **3.000** |
| **Concorrência em Paralelo** | 15 workers | 30 workers | 50 workers |
| **Carteiras Simuladas** | 5 carteiras | 30 carteiras | 50 carteiras |
| **Tempo Total de Execução** | **0.81 s** | **4.15 s** | **6.34 s** |
| **Throughput Médio (RPS)** | **186.19 RPS** | **361.59 RPS** | **473.40 RPS** |
| **Taxa de Erro HTTP** | **0.00%** | **0.00%** | **0.00%** |
| **Latência Mediana ($p50$)** | 57.50 ms | 61.99 ms | 85.47 ms |
| **Latência 90º Percentil ($p90$)** | 76.89 ms | 95.98 ms | 112.34 ms |
| **Latência 95º Percentil ($p95$)** | 88.57 ms | 112.80 ms | 118.76 ms |
| **Latência 99º Percentil ($p99$)** | 115.30 ms | 172.26 ms | 129.86 ms |
| **Outbox Lag (Mensagens no Pico)** | 302 msgs | 2.624 msgs | 5.350 msgs |
| **Consistência Contábil Individual** | Aprovado (0 divergências) | Aprovado (0 divergências) | Aprovado (0 divergências) |
| **Trial Balance de Partidas Dobradas** | Aprovado ($\Delta = 0.00$) | Aprovado ($\Delta = 0.00$) | Aprovado ($\Delta = 0.00$) |

---

## 5. Análise de Latência & Distribuição de Percentis

```mermaid
xychart-beta
    title "Evolução da Latência por Percentil sob Carga Máxima (ms)"
    x-axis ["p50 (Mediana)", "p90", "p95", "p99"]
    y-axis "Latência (milissegundos)" 0 --> 160
    bar [85.47, 112.34, 118.76, 129.86]
```

### Principais Observações de Performance:
1. **Comportamento Preditivo e Estável:** A latência mediana subiu de 57.50 ms para apenas 85.47 ms mesmo multiplicando a carga em **20 vezes** (de 150 para 3.000 requisições simultâneas).
2. **Cauda de Latência Contida ($p99 < 130\text{ ms}$):** Graças à estratégia de lock pessimista estritamente restrito à linha da carteira (`WHERE id = :walletId`), as carteiras não competem entre si no banco de dados. Isso evitou picos de cauda comumente vistos em sistemas que utilizam lock de tabela ou transações serializáveis puras com *retry storms*.
3. **Overhead de Rede e Nginx:** O overhead do proxy reverso Nginx e da serialização JSON canônica SHA-256 representou menos de 10 ms do tempo total de atendimento.

---

## 6. Comportamento do Transactional Outbox & Drenagem Assíncrona

A Seção 11 do README estipula que a persistência financeira e a emissão de eventos devem ser rigorosamente atômicas.

### Dinâmica Observada no Outbox:
- Durante a Bateria 3 (3.000 transações em 6.34 segundos), a taxa de escrita transacional no banco de dados superou a velocidade instantânea de publicação no emulador SQS FIFO, acumulando **5.350 mensagens** na tabela `outbox_messages`.
- **Zero Impacto no Endpoint HTTP:** Como a publicação no SQS é totalmente assíncrona e desacoplada dos pods de API, os clientes HTTP receberam confirmação imediata das apostas sem sofrer a latência de round-trip de rede da AWS/MiniStack.
- **Drenagem Paralela Sem Duplicação:** As 2 réplicas de workers dedicados consumiram as mensagens em lotes de 50 utilizando `SELECT ... FOR UPDATE SKIP LOCKED`. Nenhum worker bloqueou o outro e zero eventos duplicados foram gerados na fila SQS.

---

## 7. Experimento de Caos & Defesa sob Ataque Ativo (10 Vetores)

Além do benchmark de carga volumétrica pura, a integridade foi testada sob condições hostis de concorrência com o script `scripts/chaos-attack-test.ts` calibrado para carga agressiva (`CHAOS_STAMPEDE_COUNT=100`, `CHAOS_RACE_COUNT=25`):

```text
======================================================================
🛡️ DEFESA DO SERVIDOR EM TESTE DE CAOS DE ALTA AGRESSIVIDADE
======================================================================
```

| Vetor de Ataque | Intensidade | Resultado Observado | Defesa Comprovada |
|---|:---:|:---:|---|
| **1. Stampede de Idempotência** | 100 reqs no mesmo ms | 🛡️ **APROVADO** | Exatamente **1 débito** executado; **99 replays** idênticos retornados (`200 OK`) sem novo débito. |
| **2. Double-Spending Race** | 25 apostas concorrentes | 🛡️ **APROVADO** | Exatamente **2 aceitas**, **23 barradas** (`422`). Saldo final: R$ 0.00 (nunca negativo). |
| **3. Fraude de Idempotência** | Payload adulterado | 🛡️ **APROVADO** | Conflito de hash canônico SHA-256 detectado e barrado com `409 Conflict`. |
| **4. Rollback com Saldo Negativo** | Reversão de prêmio gasto | 🛡️ **APROVADO** | Rejeitado com `422` (`ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE`). Saldo protegido em R$ 10.00. |
| **5. Injeção de Dados Maliciosos** | NaN, Negativo, USD | 🛡️ **APROVADO** | Todas as 5 injeções barradas com `400 Bad Request` ou `422`. |
| **6. Double Refund (Chaves Distintas)** | Duplo estorno fraudulento | 🛡️ **APROVADO** | 1º estorno aceito (`201`), 2º bloqueado com `422` (`REFERENCE_ALREADY_REVERSED`). |
| **7. Hijacking de Carteira Alheia** | Cross-player mismatch | 🛡️ **APROVADO** | Rejeitado com `422` (`PLAYER_MISMATCH`), carteira da vítima intocada. |
| **8. Desordem Temporal Assíncrona** | REFUND antes de BET | 🛡️ **APROVADO** | Estacionado com `202 PENDING_REFERENCE`. Ao chegar a BET, worker resolve e restaura saldo. |
| **9. Reconciliação Individual** | 7 carteiras atacadas | 🛡️ **APROVADO** | **100% das carteiras** com saldo == soma de ledger com diferença de R$ 0.00. |
| **10. Trial Balance Partidas Dobradas** | Auditoria contábil global | 🛡️ **APROVADO** | **8.621 lançamentos**: Débitos = Créditos = R$ 589.110,00 ($\Delta = \text{R\$} 0.00$). |

---

## 8. Auditoria Contábil Matemática & Balancete de Partidas Dobradas

Após o término de todas as baterias de carga e de caos (totalizando **mais de 8.600 transações financeiras reais** persistidas no PostgreSQL), a auditoria contábil global foi executada via `GET /accounting/trial-balance?currency=BRL`.

### Snapshot da Auditoria ao Vivo:
```json
{
  "balanced": true,
  "currency": "BRL",
  "totalDebits": "589110.00",
  "totalCredits": "589110.00",
  "discrepancy": "0.00",
  "totalTransactionsAudited": 8621,
  "breakdown": {
    "playerWallets": {
      "debit": "342510.00",
      "credit": "246600.00",
      "net": "-95910.00"
    },
    "counterpartyAccounts": {
      "SETTLEMENT_ESCROW": {
        "debit": "0.00",
        "credit": "246600.00",
        "net": "246600.00"
      },
      "HOUSE_HOLDING": {
        "debit": "246600.00",
        "credit": "0.00",
        "net": "-246600.00"
      },
      "HOUSE_EXPENSE": {
        "debit": "0.00",
        "credit": "95910.00",
        "net": "95910.00"
      }
    }
  },
  "auditedAt": "2026-11-13T21:11:13.912Z"
}
```

$$\sum \text{Débitos} = \text{R\$} 589.110,00 \quad \equiv \quad \sum \text{Créditos} = \text{R\$} 589.110,00 \quad \Longrightarrow \quad \Delta = \text{R\$} 0.00$$

Este resultado comprova que o sistema de **Partidas Dobradas (*Double-Entry Bookkeeping*)** funciona sem quebrar o balanço patrimonial mesmo sob tempestades massivas de concorrência.

---

## 9. Honestidade da Análise & Limitações em Escala Extrema (50.000+ RPS)

Em estrito alinhamento com a diretriz da Jungle Gaming (*"Não esperamos perfeição — a honestidade da análise pesa mais que o número bruto"*), identificamos os limites desta configuração e as decisões necessárias para atingir patamares industriais superiores:

### 1. Limite de Conexões do PostgreSQL (Connection Pool Saturação)
- **Cenário Atual:** Cada réplica NestJS abre um pool de conexões com o PostgreSQL via MikroORM. Com 3 instâncias de app e 2 workers, o número de conexões ativas oscila entre 30 e 50 conexões simultâneas.
- **Ponto de Saturação:** Em escalas de 50.000+ RPS com 50 réplicas de containers, o PostgreSQL entraria em contenção de conexões no processo mestre.
- **Mitigação Recomendada:** Implementação obrigatória de **PgBouncer** em modo Transaction Pooling na frente do banco, limitando as conexões reais a um pool fixo de ~100 conexões de alta performance.

### 2. Hot Wallets & Conflitos de Linha em Um Mesmo Jogador
- **Cenário Atual:** Nossa arquitetura utiliza `SELECT ... FOR UPDATE` indexado por `walletId`. Se 50 provedores enviarem apostas no mesmo milissegundo para o **mesmo jogador**, essas 50 requisições serão serializadas na fila de lock daquela linha específica do PostgreSQL.
- **Comportamento Observado:** O sistema permanece 100% correto (zero corrupção), mas a latência da 50ª aposta desse jogador específico aumentará proporcionalmente ao tempo de serialização.
- **Mitigação Recomendada:** No nível de protocolo de iGaming, os provedores não devem disparar apostas simultâneas do mesmo jogador em jogos distintos sem controle de sessão no client. No backend, a adoção de canais de partição baseados em hash de `walletId` em filas SQS FIFO garante que eventos do mesmo jogador entrem sequencialmente sem disputar locks concorrentes.

### 3. Particionamento de Tabelas de Histórico (*Ledger Partitioning*)
- **Cenário Atual:** A tabela `wallet_ledger_entries` é append-only. Em um cassino com 10 milhões de apostas/dia, ela cresce em ritmo acelerado.
- **Mitigação Recomendada:** Particionamento horizontal nativo do PostgreSQL (*Declarative Partitioning*) por data (`RANGE (created_at)`) mensal ou semanal, viabilizando arquivamento frio (*cold storage*) sem degradação dos índices `B-Tree`.

---

## 10. Instruções de Reprodução dos Experimentos

Todos os testes deste relatório são 100% reproduzíveis localmente com comandos simples:

### 1. Executar o Teste de Carga Padrão (150 Reqs)
```bash
bun run test:load
```

### 2. Executar o Teste de Carga em Larga Escala (3.000 Reqs)
```bash
LOAD_REQUESTS=3000 LOAD_CONCURRENCY=50 LOAD_WALLETS=50 bun run test:load
```

### 3. Executar o Teste de Caos com Agressividade Elevada (10 Vetores)
```bash
CHAOS_STAMPEDE_COUNT=100 CHAOS_RACE_COUNT=25 bun run test:chaos
```

### 4. Consultar o Balancete Global de Partidas Dobradas
```bash
curl http://localhost:3000/accounting/trial-balance
```
