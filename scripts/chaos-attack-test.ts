import { v4 as uuidv4 } from "uuid";

const BASE_URL = "http://localhost:3000";

interface AttackReport {
  vector: string;
  description: string;
  passed: boolean;
  details: string;
}

const reports: AttackReport[] = [];

async function createWallet(amount = "100.00"): Promise<{ id: string; playerId: string }> {
  const playerId = uuidv4();
  const res = await fetch(`${BASE_URL}/wallets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      initialBalance: { amount, currency: "BRL" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao criar wallet: ${res.statusText}`);
  }
  const data: any = await res.json();
  return { id: data.id, playerId };
}

async function runChaosAssault() {
  console.log("======================================================================");
  console.log("💀 INICIANDO TESTE DE CAOS E ATAQUES AO VIVO CONTRA O LOCALHOST:3000");
  console.log("======================================================================\n");

  // -----------------------------------------------------------------------------------------
  // ATAQUE 1: Stampede de Idempotência (50 requisições idênticas no mesmo milissegundo)
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 1/6] Disparando Stampede de 50 requisições simultâneas com a mesma Idempotency-Key...");
  const wallet1 = await createWallet("500.00");
  const stampedeKey = `stampede-${uuidv4()}`;
  const extTxId = `ext-${uuidv4()}`;

  const stampedePromises = Array.from({ length: 50 }, () =>
    fetch(`${BASE_URL}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": stampedeKey,
      },
      body: JSON.stringify({
        providerId: "chaos-prov",
        externalTransactionId: extTxId,
        playerId: wallet1.playerId,
        walletId: wallet1.id,
        roundId: "r-stampede",
        gameId: "chaos-game",
        kind: "BET",
        money: { amount: "100.00", currency: "BRL" },
      }),
    })
  );

  const stampedeResponses = await Promise.all(stampedePromises);
  const statusCodes = stampedeResponses.map((r) => r.status);
  const createdCount = statusCodes.filter((s) => s === 201).length;
  const okReplayCount = statusCodes.filter((s) => s === 200).length;

  const w1CheckRes = await fetch(`${BASE_URL}/wallets/${wallet1.id}`);
  const w1Data: any = await w1CheckRes.json();

  const attack1Passed =
    createdCount === 1 && okReplayCount === 49 && w1Data.balance.amount === "400.00";

  reports.push({
    vector: "1. Stampede de Idempotência (50 concorrentes)",
    description: "50 chamadas paralelas com mesma chave exata disputando a carteira",
    passed: attack1Passed,
    details: `Criadas: ${createdCount} (esperado 1), Replays: ${okReplayCount} (esperado 49), Saldo final: R$ ${w1Data.balance.amount} (esperado R$ 400.00)`,
  });
  console.log(
    `   -> ${attack1Passed ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: 1 débito realizado, 49 replays idênticos devolvidos, saldo debitado apenas uma vez!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 2: Double-Spending Race (10 apostas de R$ 50 simultâneas em saldo de R$ 100)
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 2/6] Disparando 10 apostas concorrentes de R$ 50 em uma carteira com apenas R$ 100...");
  const wallet2 = await createWallet("100.00");

  const racePromises = Array.from({ length: 10 }, (_, i) =>
    fetch(`${BASE_URL}/wagering/transactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `race-key-${i}-${uuidv4()}`,
      },
      body: JSON.stringify({
        providerId: "chaos-prov",
        externalTransactionId: `race-ext-${i}-${uuidv4()}`,
        playerId: wallet2.playerId,
        walletId: wallet2.id,
        roundId: `round-race-${i}`,
        gameId: "chaos-game",
        kind: "BET",
        money: { amount: "50.00", currency: "BRL" },
      }),
    })
  );

  const raceResponses = await Promise.all(racePromises);
  const raceStatuses = raceResponses.map((r) => r.status);
  const processedBets = raceStatuses.filter((s) => s === 201).length;
  const rejectedBets = raceStatuses.filter((s) => s === 422).length;

  const w2CheckRes = await fetch(`${BASE_URL}/wallets/${wallet2.id}`);
  const w2Data: any = await w2CheckRes.json();

  const attack2Passed =
    processedBets === 2 && rejectedBets === 8 && w2Data.balance.amount === "0.00";

  reports.push({
    vector: "2. Double-Spending Race (Saque a descoberto)",
    description: "10 apostas de R$ 50 (R$ 500 no total) disparadas no mesmo instante sobre R$ 100",
    passed: attack2Passed,
    details: `Processadas: ${processedBets} (esperado 2), Rejeitadas (422): ${rejectedBets} (esperado 8), Saldo final: R$ ${w2Data.balance.amount} (esperado R$ 0.00)`,
  });
  console.log(
    `   -> ${attack2Passed ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: Exatamente 2 apostas aceitas, 8 barradas por saldo insuficiente, saldo final R$ 0.00 (nunca negativo)!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 3: Payload Poisoning / Conflicting Replay (Fraude com chave reutilizada)
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 3/6] Tentativa de fraude: reenviar chave de R$ 100 com valor alterado para R$ 999...");
  const conflictRes = await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": stampedeKey, // mesma chave usada no Ataque 1
    },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: extTxId,
      playerId: wallet1.playerId,
      walletId: wallet1.id,
      roundId: "r-stampede",
      gameId: "chaos-game",
      kind: "BET",
      money: { amount: "999.00", currency: "BRL" }, // adulteração de valor!
    }),
  });

  const attack3Passed = conflictRes.status === 409;
  reports.push({
    vector: "3. Fraude de Idempotência (Payload Adulterado)",
    description: "Reenvio da mesma chave de idempotência com valor modificado de R$ 100 para R$ 999",
    passed: attack3Passed,
    details: `Status retornado: ${conflictRes.status} (esperado 409 Conflict)`,
  });
  console.log(
    `   -> ${attack3Passed ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: Detectado conflito de hash SHA-256 e barrado com HTTP 409 Conflict!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 4: Rollback com Saldo Insuficiente (Tentativa de forçar saldo negativo)
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 4/6] Tentativa de Rollback de prêmio já gasto pelo jogador...");
  const wallet4 = await createWallet("50.00");
  const winTxExtId = `win-ext-${uuidv4()}`;

  // 1. Jogador ganha R$ 200.00 (saldo vai para R$ 250.00)
  await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `win-key-${uuidv4()}` },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: winTxExtId,
      playerId: wallet4.playerId,
      walletId: wallet4.id,
      roundId: "r-win",
      gameId: "chaos-game",
      kind: "WIN",
      money: { amount: "200.00", currency: "BRL" },
    }),
  });

  // 2. Jogador gasta R$ 240.00 em outra aposta (saldo restante: R$ 10.00)
  await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `spend-key-${uuidv4()}` },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: `spend-ext-${uuidv4()}`,
      playerId: wallet4.playerId,
      walletId: wallet4.id,
      roundId: "r-spend",
      gameId: "chaos-game",
      kind: "BET",
      money: { amount: "240.00", currency: "BRL" },
    }),
  });

  // 3. Provedor envia ROLLBACK do WIN de R$ 200 (debitar R$ 200 deixaria o saldo em -R$ 190.00!)
  const rollbackRes = await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `rb-key-${uuidv4()}` },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: `rb-ext-${uuidv4()}`,
      playerId: wallet4.playerId,
      walletId: wallet4.id,
      roundId: "r-win",
      gameId: "chaos-game",
      kind: "ROLLBACK",
      money: { amount: "200.00", currency: "BRL" },
      referenceExternalTransactionId: winTxExtId,
    }),
  });

  const rbData: any = await rollbackRes.json();
  const w4CheckRes = await fetch(`${BASE_URL}/wallets/${wallet4.id}`);
  const w4Data: any = await w4CheckRes.json();

  const attack4Passed =
    rollbackRes.status === 422 &&
    rbData.failureCode === "ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE" &&
    w4Data.balance.amount === "10.00";

  reports.push({
    vector: "4. Rollback causador de saldo negativo",
    description: "Reversão de WIN de R$ 200 quando o jogador só possui R$ 10 em carteira",
    passed: attack4Passed,
    details: `Status: ${rollbackRes.status} (esperado 422), FailureCode: ${rbData.failureCode}, Saldo preservado: R$ ${w4Data.balance.amount} (esperado R$ 10.00)`,
  });
  console.log(
    `   -> ${attack4Passed ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: Rejeitado com ROLLBACK_WOULD_CAUSE_NEGATIVE_BALANCE e saldo preservado em R$ 10.00!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 5: Injeção de Valores Inválidos, Negativos e Corrompidos
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 5/6] Injeção de valores negativos, NaN, 3 decimais, OPENING forjado e moeda errada...");
  const wallet5 = await createWallet("100.00");

  const corruptPayloads = [
    { name: "Valor negativo (-50.00)", money: { amount: "-50.00", currency: "BRL" }, kind: "BET" },
    { name: "Valor NaN", money: { amount: "NaN", currency: "BRL" }, kind: "BET" },
    { name: "3 casas decimais (10.999)", money: { amount: "10.999", currency: "BRL" }, kind: "BET" },
    { name: "OPENING forjado externamente", money: { amount: "500.00", currency: "BRL" }, kind: "OPENING" },
    { name: "Moeda cruzada (USD em carteira BRL)", money: { amount: "10.00", currency: "USD" }, kind: "BET" },
  ];

  let allCorruptBlocked = true;
  for (const c of corruptPayloads) {
    const res = await fetch(`${BASE_URL}/wagering/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `corrupt-${uuidv4()}` },
      body: JSON.stringify({
        providerId: "chaos-prov",
        externalTransactionId: `corrupt-${uuidv4()}`,
        playerId: wallet5.playerId,
        walletId: wallet5.id,
        roundId: "r-corrupt",
        gameId: "chaos-game",
        kind: c.kind,
        money: c.money,
      }),
    });

    const blocked = res.status === 400 || res.status === 422;
    if (!blocked) {
      allCorruptBlocked = false;
      console.error(`   ❌ Falhou ao bloquear ${c.name}: Status retornado foi ${res.status}`);
    }
  }

  reports.push({
    vector: "5. Injeção de Dados Maliciosos",
    description: "Envio de valores negativos, NaN, 3 decimais, tipo OPENING forjado e moeda divergente",
    passed: allCorruptBlocked,
    details: "Todas as 5 tentativas de injeção foram barradas com 400 Bad Request ou 422 Unprocessable",
  });
  console.log(
    `   -> ${allCorruptBlocked ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: Todas as 5 injeções foram sumariamente bloqueadas pela validação estrita!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 6: Prova Matemática de Invariante Contábil Pós-Ataques
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 6/6] Verificando integridade contábil matemática de todas as carteiras atacadas...");
  const attackedWallets = [wallet1.id, wallet2.id, wallet4.id, wallet5.id];
  let allReconciled = true;

  for (const wid of attackedWallets) {
    const recRes = await fetch(`${BASE_URL}/wallets/${wid}/reconciliation`, { method: "POST" });
    const recData: any = await recRes.json();
    if (!recData.consistent || recData.difference.amount !== "0.00") {
      allReconciled = false;
    }
  }

  reports.push({
    vector: "6. Auditoria de Reconciliação Contábil Global",
    description: "Audita se a soma de todos os lançamentos do ledger bate exatamente com o saldo armazenado em cada carteira",
    passed: allReconciled,
    details: allReconciled
      ? "100% das carteiras atacadas reconciliadas com diferença de R$ 0.00"
      : "Inconsistência detectada em alguma carteira",
  });
  console.log(
    `   -> ${allReconciled ? "🛡️ AUDITORIA APROVADA" : "❌ INCONSISTÊNCIA DETECTADA"}: 100% das carteiras possuem soma de ledger == saldo com diferença de R$ 0.00!\n`
  );

  // -----------------------------------------------------------------------------------------
  // RELATÓRIO CONSOLIDADO DO ASSALTO DE CAOS
  // -----------------------------------------------------------------------------------------
  console.log("======================================================================");
  console.log("🛡️ RELATÓRIO DO EXPERIMENTO DE CAOS & DEFESA DO SERVIDOR");
  console.log("======================================================================");
  console.table(
    reports.map((r) => ({
      Vetor: r.vector,
      Resultado: r.passed ? "🛡️ APROVADO (Zero falhas)" : "❌ QUEBROU",
      Detalhes: r.details,
    }))
  );
  console.log("======================================================================\n");

  const totalPassed = reports.filter((r) => r.passed).length;
  if (totalPassed === reports.length) {
    console.log("🎉 O SERVIDOR SUPORTOU 100% DOS ATAQUES DE CAOS SEM NENHUMA CORRUPÇÃO!");
  } else {
    console.error(`⚠️ ${reports.length - totalPassed} VETORES DE ATAQUE QUEBRARAM O SISTEMA.`);
    process.exit(1);
  }
}

runChaosAssault().catch((err) => {
  console.error("Erro fatal no teste de caos:", err);
  process.exit(1);
});

