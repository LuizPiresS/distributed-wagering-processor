import { v4 as uuidv4 } from "uuid";

const BASE_URL = "http://localhost:3000";

interface TestResult {
  step: string;
  endpoint: string;
  status: number;
  expectedStatus: number;
  passed: boolean;
  details?: any;
}

const results: TestResult[] = [];

async function logStep(
  step: string,
  endpoint: string,
  expectedStatus: number,
  fn: () => Promise<Response>
) {
  try {
    const res = await fn();
    const passed = res.status === expectedStatus;
    let body: any;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await res.json();
    } else {
      body = await res.text();
    }

    results.push({
      step,
      endpoint,
      status: res.status,
      expectedStatus,
      passed,
      details: body,
    });

    console.log(
      `${passed ? "✅" : "❌"} [${step}] ${endpoint} -> Status ${res.status} (Esperado ${expectedStatus})`
    );
    return body;
  } catch (err: any) {
    results.push({
      step,
      endpoint,
      status: 0,
      expectedStatus,
      passed: false,
      details: err.message,
    });
    console.error(`❌ [${step}] ${endpoint} -> Erro de conexao: ${err.message}`);
    return null;
  }
}

async function run() {
  console.log("=================================================");
  console.log("   INICIANDO TESTE END-TO-END NO LOCALHOST:3000  ");
  console.log("=================================================\n");

  // 1. Health Live
  await logStep("1. Health Live", "GET /health/live", 200, () =>
    fetch(`${BASE_URL}/health/live`)
  );

  // 2. Health Ready
  await logStep("2. Health Ready", "GET /health/ready", 200, () =>
    fetch(`${BASE_URL}/health/ready`)
  );

  // 3. Metrics (Prometheus Text)
  await logStep("3. Metricas Prometheus", "GET /metrics", 200, () =>
    fetch(`${BASE_URL}/metrics`)
  );

  // 4. Metrics (JSON)
  await logStep("4. Metricas JSON", "GET /metrics", 200, () =>
    fetch(`${BASE_URL}/metrics`, { headers: { Accept: "application/json" } })
  );

  // 5. Criar Wallet com Saldo Inicial
  const playerId = uuidv4();
  const createWalletRes = await logStep("5. Criar Wallet", "POST /wallets", 201, () =>
    fetch(`${BASE_URL}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "1000.00", currency: "BRL" },
      }),
    })
  );

  if (!createWalletRes || !createWalletRes.id) {
    console.error("Falha ao criar wallet. Abortando fluxo dependente.");
    return;
  }

  const walletId = createWalletRes.id;
  console.log(`   -> Wallet criada com sucesso: ${walletId} (Saldo: R$ 1000.00)\n`);

  // 6. Consultar Wallet criada
  await logStep("6. Consultar Wallet", `GET /wallets/${walletId}`, 200, () =>
    fetch(`${BASE_URL}/wallets/${walletId}`)
  );

  // 7. Tentativa de criar Wallet duplicada (deve falhar com 409 Conflict)
  await logStep("7. Wallet Duplicada (Mesmo Player+Moeda)", "POST /wallets", 409, () =>
    fetch(`${BASE_URL}/wallets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        initialBalance: { amount: "500.00", currency: "BRL" },
      }),
    })
  );

  // 8. Executar Aposta BET de R$ 100.00
  const betKey = `prov-e2e:bet-${uuidv4().substring(0, 8)}`;
  const betExtId = `ext-${uuidv4().substring(0, 8)}`;
  const roundId = `round-${uuidv4().substring(0, 8)}`;

  const betPayload = {
    providerId: "prov-e2e",
    externalTransactionId: betExtId,
    playerId,
    walletId,
    roundId,
    gameId: "fortune-tiger",
    kind: "BET",
    money: { amount: "100.00", currency: "BRL" },
  };

  const betRes = await logStep(
    "8. Submeter BET (R$ 100.00)",
    "POST /wagering/transactions",
    201,
    () =>
      fetch(`${BASE_URL}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": betKey,
        },
        body: JSON.stringify(betPayload),
      })
  );
  console.log(`   -> Saldo apos BET: R$ ${betRes?.balance?.amount} (idempotentReplay: ${betRes?.idempotentReplay})\n`);

  // 9. Replay Idempotente da BET (mesma chave e mesmo payload -> 200 OK, replay true)
  const replayRes = await logStep(
    "9. Replay Idempotente da BET",
    "POST /wagering/transactions",
    200,
    () =>
      fetch(`${BASE_URL}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": betKey,
        },
        body: JSON.stringify(betPayload),
      })
  );
  console.log(`   -> Replay confirmado: idempotentReplay=${replayRes?.idempotentReplay}\n`);

  // 10. Conflito de Idempotencia (mesma chave, payload divergente -> 409 Conflict)
  const conflictPayload = { ...betPayload, money: { amount: "200.00", currency: "BRL" } };
  await logStep(
    "10. Conflito de Idempotencia (Payload Divergente)",
    "POST /wagering/transactions",
    409,
    () =>
      fetch(`${BASE_URL}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": betKey,
        },
        body: JSON.stringify(conflictPayload),
      })
  );

  // 11. Saldo Insuficiente (aposta de R$ 5000.00 em saldo de R$ 900.00 -> 422 Unprocessable)
  const highBetKey = `prov-e2e:high-bet-${uuidv4().substring(0, 8)}`;
  await logStep(
    "11. Saldo Insuficiente (Aposta R$ 5000 em saldo R$ 900)",
    "POST /wagering/transactions",
    422,
    () =>
      fetch(`${BASE_URL}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": highBetKey,
        },
        body: JSON.stringify({
          providerId: "prov-e2e",
          externalTransactionId: `ext-${uuidv4().substring(0, 8)}`,
          playerId,
          walletId,
          roundId: `round-${uuidv4().substring(0, 8)}`,
          gameId: "fortune-tiger",
          kind: "BET",
          money: { amount: "5000.00", currency: "BRL" },
        }),
      })
  );

  // 12. Premio WIN de R$ 350.00
  const winKey = `prov-e2e:win-${uuidv4().substring(0, 8)}`;
  const winRes = await logStep(
    "12. Submeter WIN (R$ 350.00)",
    "POST /wagering/transactions",
    201,
    () =>
      fetch(`${BASE_URL}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": winKey,
        },
        body: JSON.stringify({
          providerId: "prov-e2e",
          externalTransactionId: `ext-${uuidv4().substring(0, 8)}`,
          playerId,
          walletId,
          roundId,
          gameId: "fortune-tiger",
          kind: "WIN",
          money: { amount: "350.00", currency: "BRL" },
          referenceExternalTransactionId: betExtId,
        }),
      })
  );
  console.log(`   -> Saldo apos WIN: R$ ${winRes?.balance?.amount}\n`);

  // 13. LOSS (sem efeito no saldo nem ledger)
  const lossKey = `prov-e2e:loss-${uuidv4().substring(0, 8)}`;
  const lossRes = await logStep(
    "13. Submeter LOSS",
    "POST /wagering/transactions",
    201,
    () =>
      fetch(`${BASE_URL}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": lossKey,
        },
        body: JSON.stringify({
          providerId: "prov-e2e",
          externalTransactionId: `ext-${uuidv4().substring(0, 8)}`,
          playerId,
          walletId,
          roundId,
          gameId: "fortune-tiger",
          kind: "LOSS",
          money: { amount: "0.00", currency: "BRL" },
        }),
      })
  );
  console.log(`   -> Saldo apos LOSS permanece intacto: R$ ${lossRes?.balance?.amount}\n`);

  // 14. REFUND da BET original (R$ 100.00)
  const refundKey = `prov-e2e:refund-${uuidv4().substring(0, 8)}`;
  const refundRes = await logStep(
    "14. Submeter REFUND da BET",
    "POST /wagering/transactions",
    201,
    () =>
      fetch(`${BASE_URL}/wagering/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": refundKey,
        },
        body: JSON.stringify({
          providerId: "prov-e2e",
          externalTransactionId: `ext-${uuidv4().substring(0, 8)}`,
          playerId,
          walletId,
          roundId,
          gameId: "fortune-tiger",
          kind: "REFUND",
          money: { amount: "100.00", currency: "BRL" },
          referenceExternalTransactionId: betExtId,
        }),
      })
  );
  console.log(`   -> Saldo apos REFUND: R$ ${refundRes?.balance?.amount}\n`);

  // 15. Consultar Transacao por ID interno
  const txId = betRes.transactionId;
  await logStep(
    "15. Consultar Transacao por ID interno",
    `GET /wagering/transactions/${txId}`,
    200,
    () => fetch(`${BASE_URL}/wagering/transactions/${txId}`)
  );

  // 16. Consultar Transacao por ID Externo do Provedor
  await logStep(
    "16. Consultar Transacao por Provider + ID Externo",
    `GET /providers/prov-e2e/wagering/transactions/${betExtId}`,
    200,
    () => fetch(`${BASE_URL}/providers/prov-e2e/wagering/transactions/${betExtId}`)
  );

  // 17. Consultar Extrato (Ledger) com Paginacao Opaca
  const ledgerRes = await logStep(
    "17. Consultar Ledger com Cursor Opaco",
    `GET /wallets/${walletId}/ledger?limit=10`,
    200,
    () => fetch(`${BASE_URL}/wallets/${walletId}/ledger?limit=10`)
  );
  console.log(`   -> Total de lancamentos auditaveis retornados: ${ledgerRes?.items?.length} (nextCursor: ${ledgerRes?.nextCursor})\n`);

  // 18. Reconciliacao Contabil da Carteira
  const reconRes = await logStep(
    "18. Reconciliacao Contabil Estrita",
    `POST /wallets/${walletId}/reconciliation`,
    200,
    () =>
      fetch(`${BASE_URL}/wallets/${walletId}/reconciliation`, {
        method: "POST",
      })
  );
  console.log(
    `   -> Saldo Armazenado: R$ ${reconRes?.storedBalance?.amount} | Saldo Calculado pelo Ledger: R$ ${reconRes?.calculatedBalance?.amount}`
  );
  console.log(`   -> Diferenca: R$ ${reconRes?.difference?.amount} | Consistente: ${reconRes?.consistent}\n`);

  // 19. Checagem Final de Metricas Atualizadas
  const finalMetrics = await logStep("19. Snapshot Final de Metricas", "GET /metrics", 200, () =>
    fetch(`${BASE_URL}/metrics`, { headers: { Accept: "application/json" } })
  );
  console.log("   -> Metricas Observadas:", JSON.stringify(finalMetrics, null, 2));

  console.log("\n=================================================");
  const allPassed = results.every((r) => r.passed);
  if (allPassed) {
    console.log(`🎉 TODOS OS ${results.length} PASSOS FORAM CONCLUÍDOS COM 100% DE SUCESSO!`);
  } else {
    console.error(`⚠️ ALGUNS PASSOS FALHARAM: ${results.filter((r) => !r.passed).length} falhas.`);
  }
  console.log("=================================================");
}

run();
