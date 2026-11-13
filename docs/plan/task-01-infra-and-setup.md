# Task 01: Setup do Ambiente, Tooling e Infraestrutura

## 1. Objetivo
Configurar o ambiente de desenvolvimento, runtime, dependências e orquestração de contêineres garantindo paridade total com os requisitos da Seção 4 do `README.md` (Bun 1.x, TypeScript strict, NestJS, PostgreSQL e LocalStack SQS FIFO).

---

## 2. Requisitos Cobertos
- **Runtime:** Bun 1.x como package manager, runtime e test runner.
- **Linguagem:** TypeScript em modo estrito (`strict: true`, `noImplicitOverride: true`, `exactOptionalPropertyTypes: true`).
- **Framework:** NestJS configurado sobre Bun.
- **Infraestrutura Local:** Docker Compose contendo:
  - PostgreSQL 16 (porta 5432) com healthcheck nativo.
  - LocalStack (porta 4566) com provisionamento automático de filas SQS FIFO.
- **Orquestração de Múltiplas Instâncias:** Configuração pronta para simular 3 instâncias da aplicação via Compose.

---

## 3. Detalhamento Técnico

### 3.1 Inicialização do Projeto
- Instalar o Bun na máquina / contêiner (se ainda não presente).
- Inicializar `package.json` com scripts padronizados:
  - `bun run build`: compilação NestJS/TypeScript.
  - `bun run start`: execução do servidor HTTP e consumers.
  - `bun run start:worker`: inicialização dedicada dos workers de background (outbox/reprocessamento).
  - `bun test`: execução da suíte de testes unitários e de integração.
  - `bun run test:concurrency`: execução do teste de concorrência com cenários de race condition.
  - `bun run test:load`: execução do teste de carga com coleta de métricas.
  - `bun run migration:up` / `bun run migration:down`: controle de migrações reversíveis.

### 3.2 Configuração do TypeScript (`tsconfig.json`)
Garantir o nível mais rigoroso de tipagem:
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

### 3.3 Docker Compose (`docker-compose.yml`)
Serviços essenciais:
1. **`postgres`:**
   - Imagem: `postgres:16-alpine`
   - Volume persistente e script `/docker-entrypoint-initdb.d/init.sql` para habilitar extensões como `uuid-ossp` e `pgcrypto`.
   - Healthcheck via `pg_isready -U postgres`.
2. **`localstack`:**
   - Imagem: `localstack/localstack:latest`
   - Serviços habilitados: `SERVICES=sqs`
   - Script de inicialização em `/etc/localstack/init/ready.d/init-queues.sh` para criação das filas:
     - `wager-transactions.fifo` (com atributo `FifoQueue=true`, `ContentBasedDeduplication=false`)
     - `wager-transactions-dlq.fifo`
     - Configuração da política de Redrive (maxReceiveCount = 3 para a DLQ).
3. **`app` (Perfil cluster):**
   - Configuração de scaling para permitir `docker compose up --scale app=3`.

---

## 4. Checklist de Implementação
- [ ] Criar `.env.example` com todas as variáveis de ambiente necessárias (`DATABASE_URL`, `AWS_REGION`, `AWS_ENDPOINT`, `SQS_QUEUE_URL`, `PORT`, etc.).
- [ ] Criar script `scripts/init-localstack.sh` que cria as filas SQS FIFO e DLQ com suas devidas políticas de Dead Letter Queue.
- [ ] Criar `docker-compose.yml` completo com healthchecks para postgres e localstack.
- [ ] Configurar NestJS com injeção de dependência modular (`AppModule`, `ConfigModule`).
- [ ] Configurar ESLint e Prettier para padronização de código.

---

## 5. Critérios de Aceite
- [ ] Executar `docker compose up -d` sobe PostgreSQL e LocalStack com status `healthy`.
- [ ] As filas `wager-transactions.fifo` e `wager-transactions-dlq.fifo` são criadas automaticamente no LocalStack.
- [ ] A aplicação compila via `bun run build` sem avisos ou erros de TypeScript estrito.

