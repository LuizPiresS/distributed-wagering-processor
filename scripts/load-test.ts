import { NestFactory } from "@nestjs/core";
import { v4 as uuidv4 } from "uuid";
import { AppModule } from "../src/app.module";
import { Currency } from "../src/domain";
import { MikroORM } from "@mikro-orm/postgresql";
import mikroOrmConfig from "../src/infrastructure/database/mikro-orm.config";

interface RequestResult {
  readonly durationMs: number;
  readonly status: number;
  readonly ok: boolean;
}

function calculatePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return Number(sorted[Math.max(0, Math.min(index, sorted.length - 1))]?.toFixed(2));
}

async function runLoadTest() {
  console.log("==========================================================");
  console.log("⚡ INICIANDO TESTE DE CARGA (DISTRIBUTED WAGERING PROCESSOR)");
  console.log("==========================================================");

  const defaultTarget = process.env.TARGET_URL || "http://localhost:3000";
  let baseUrl = defaultTarget;
  let app: any = null;
  let orm: MikroORM;

  try {
    const liveCheck = await fetch(`${defaultTarget}/health/live`);
    if (liveCheck.ok) {
      console.log(`🎯 Conectado ao servidor ativo no localhost: ${defaultTarget}`);
      orm = await MikroORM.init(mikroOrmConfig);
    } else {
      throw new Error("Local server not ready");
    }
  } catch {
    console.log("Servidor local não detectado. Inicializando instância dedicada...");
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    baseUrl = await app.getUrl();
    orm = app.get(MikroORM);
    console.log(`Servidor de teste ativo em: ${baseUrl}`);
  }

  // 1. Setup inicial de carteiras
  const WALLETS_COUNT = process.env.LOAD_WALLETS ? parseInt(process.env.LOAD_WALLETS, 10) : 5;
  console.log(`\n📦 Provisionando ${WALLETS_COUNT} carteiras para o teste...`);
  const wallets: { id: string; playerId: string }[] = [];

  for (let i = 1; i <= WALLETS_COUNT; i++) {
    const playerId = uuidv4();
    const res = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "1000.00", currency: Currency.BRL },
      }),
    });
    const data: any = await res.json();
    wallets.push({ id: data.id, playerId });
  }

  console.log(`✅ ${WALLETS_COUNT} carteiras criadas com saldo inicial de 1000.00 BRL cada.`);

  // 2. Execução da carga
  const TOTAL_REQUESTS = process.env.LOAD_REQUESTS ? parseInt(process.env.LOAD_REQUESTS, 10) : 150;
  const CONCURRENCY = process.env.LOAD_CONCURRENCY ? parseInt(process.env.LOAD_CONCURRENCY, 10) : 15;
  console.log(
    `\n🚀 Disparando ${TOTAL_REQUESTS} operações concorrentes (${CONCURRENCY} workers em paralelo)...`,
  );

  const results: RequestResult[] = [];
  const startTime = performance.now();

  const operations = Array.from({ length: TOTAL_REQUESTS }, (_, idx) => {
    const wallet = wallets[idx % wallets.length]!;
    const isWin = idx % 4 === 0;
    return {
      walletId: wallet.id,
      playerId: wallet.playerId,
      kind: isWin ? "WIN" : "BET",
      amount: isWin ? "20.00" : "15.00",
      idempotencyKey: `load-key-${idx}-${uuidv4()}`,
      externalTransactionId: `load-tx-${idx}-${uuidv4()}`,
    };
  });

  // Executa em chunks concorrentes
  for (let i = 0; i < operations.length; i += CONCURRENCY) {
    const chunk = operations.slice(i, i + CONCURRENCY);
    const chunkPromises = chunk.map(async (op) => {
      const reqStart = performance.now();
      try {
        const response = await fetch(`${baseUrl}/wagering/transactions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": op.idempotencyKey,
          },
          body: JSON.stringify({
            providerId: "load-tester",
            externalTransactionId: op.externalTransactionId,
            playerId: op.playerId,
            walletId: op.walletId,
            roundId: `round-${op.idempotencyKey}`,
            gameId: "slots-load",
            kind: op.kind,
            money: { amount: op.amount, currency: Currency.BRL },
          }),
        });

        const reqEnd = performance.now();
        return {
          durationMs: reqEnd - reqStart,
          status: response.status,
          ok: response.status >= 200 && response.status < 300,
        };
      } catch {
        const reqEnd = performance.now();
        return {
          durationMs: reqEnd - reqStart,
          status: 500,
          ok: false,
        };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  const totalDurationSeconds = (performance.now() - startTime) / 1000;
  const throughputRps = Number((TOTAL_REQUESTS / totalDurationSeconds).toFixed(2));

  // 3. Estatísticas e Percentis de Latência
  const sortedDurations = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const p50 = calculatePercentile(sortedDurations, 50);
  const p90 = calculatePercentile(sortedDurations, 90);
  const p95 = calculatePercentile(sortedDurations, 95);
  const p99 = calculatePercentile(sortedDurations, 99);

  const successCount = results.filter((r) => r.ok).length;
  const errorCount = results.filter((r) => !r.ok).length;
  const errorRate = Number(((errorCount / TOTAL_REQUESTS) * 100).toFixed(2));

  // 4. Medição de Outbox Lag
  const fork = orm.em.fork();
  const rawLag = await fork.getConnection().execute<{ count: string }[]>(
    "SELECT COUNT(*) as count FROM outbox_messages WHERE published_at IS NULL;",
  );
  const outboxLag = Number(rawLag[0]?.count || 0);

  // 5. Verificação da Invariante Contábil de todas as carteiras
  console.log("\n🔍 Verificando Reconciliação Contábil de todas as carteiras...");
  let allConsistent = true;
  for (const wallet of wallets) {
    const recRes = await fetch(`${baseUrl}/wallets/${wallet.id}/reconciliation`, {
      method: "POST",
    });
    const recData: any = await recRes.json();
    if (!recData.consistent) {
      allConsistent = false;
    }
  }

  // 6. Relatório Final Formatado
  console.log("\n==========================================================");
  console.log("📊 RELATÓRIO DO EXPERIMENTO DE CARGA");
  console.log("==========================================================");
  console.table({
    "Total Requisições": TOTAL_REQUESTS,
    "Concorrência": CONCURRENCY,
    "Tempo Total (s)": totalDurationSeconds.toFixed(2),
    "Throughput (RPS)": throughputRps,
    "Taxa de Erro (%)": `${errorRate}%`,
    "Latência p50 (ms)": `${p50} ms`,
    "Latência p90 (ms)": `${p90} ms`,
    "Latência p95 (ms)": `${p95} ms`,
    "Latência p99 (ms)": `${p99} ms`,
    "Outbox Lag (mensagens pendentes)": outboxLag,
    "Consistência Contábil (100%)": allConsistent ? "APROVADO (0 divergências)" : "FALHOU",
  });
  console.log("==========================================================\n");

  try {
    const metricsRes = await fetch(`${baseUrl}/metrics`, {
      headers: { Accept: "application/json" },
    });
    if (metricsRes.ok) {
      const metricsData = await metricsRes.json();
      console.log("📈 Métricas em Tempo Real no Servidor (/metrics):");
      console.log(JSON.stringify(metricsData, null, 2));
    }
  } catch { }

  if (app) {
    await app.close();
  } else if (orm) {
    await orm.close();
  }

  if (!allConsistent || errorRate > 0) {
    process.exit(1);
  }
}

runLoadTest().catch((err) => {
  console.error("Erro fatal no teste de carga:", err);
  process.exit(1);
});

