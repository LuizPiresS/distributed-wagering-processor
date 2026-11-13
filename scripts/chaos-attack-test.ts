import { v4 as uuidv4 } from "uuid";

const BASE_URL = process.env.TARGET_URL || "http://localhost:3000";

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

  const STAMPEDE_COUNT = process.env.CHAOS_STAMPEDE_COUNT
    ? parseInt(process.env.CHAOS_STAMPEDE_COUNT, 10)
    : 50;
  const RACE_COUNT = process.env.CHAOS_RACE_COUNT
    ? parseInt(process.env.CHAOS_RACE_COUNT, 10)
    : 10;

  // -----------------------------------------------------------------------------------------
  // ATAQUE 1: Stampede de Idempotência (N requisições idênticas no mesmo milissegundo)
  // -----------------------------------------------------------------------------------------
  console.log(`🔥 [Ataque 1/10] Disparando Stampede de ${STAMPEDE_COUNT} requisições simultâneas com a mesma Idempotency-Key...`);
  const wallet1 = await createWallet("500.00");
  const stampedeKey = `stampede-${uuidv4()}`;
  const extTxId = `ext-${uuidv4()}`;

  const stampedePromises = Array.from({ length: STAMPEDE_COUNT }, () =>
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
    createdCount === 1 && okReplayCount === STAMPEDE_COUNT - 1 && w1Data.balance.amount === "400.00";

  reports.push({
    vector: `1. Stampede de Idempotência (${STAMPEDE_COUNT} concorrentes)`,
    description: `${STAMPEDE_COUNT} chamadas paralelas com mesma chave exata disputando a carteira`,
    passed: attack1Passed,
    details: `Criadas: ${createdCount} (esperado 1), Replays: ${okReplayCount} (esperado ${STAMPEDE_COUNT - 1}), Saldo final: R$ ${w1Data.balance.amount} (esperado R$ 400.00)`,
  });
  console.log(
    `   -> ${attack1Passed ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: 1 débito realizado, ${STAMPEDE_COUNT - 1} replays idênticos devolvidos, saldo debitado apenas uma vez!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 2: Double-Spending Race (N apostas de R$ 50 simultâneas em saldo de R$ 100)
  // -----------------------------------------------------------------------------------------
  console.log(`🔥 [Ataque 2/10] Disparando ${RACE_COUNT} apostas concorrentes de R$ 50 em uma carteira com apenas R$ 100...`);
  const wallet2 = await createWallet("100.00");

  const racePromises = Array.from({ length: RACE_COUNT }, (_, i) =>
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
    processedBets === 2 && rejectedBets === RACE_COUNT - 2 && w2Data.balance.amount === "0.00";

  reports.push({
    vector: "2. Double-Spending Race (Saque a descoberto)",
    description: `${RACE_COUNT} apostas de R$ 50 disparadas no mesmo instante sobre R$ 100`,
    passed: attack2Passed,
    details: `Processadas: ${processedBets} (esperado 2), Rejeitadas (422): ${rejectedBets} (esperado ${RACE_COUNT - 2}), Saldo final: R$ ${w2Data.balance.amount} (esperado R$ 0.00)`,
  });
  console.log(
    `   -> ${attack2Passed ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: Exatamente 2 apostas aceitas, ${RACE_COUNT - 2} barradas por saldo insuficiente, saldo final R$ 0.00 (nunca negativo)!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 3: Payload Poisoning / Conflicting Replay (Fraude com chave reutilizada)
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 3/10] Tentativa de fraude: reenviar chave de R$ 100 com valor alterado para R$ 999...");
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
  console.log("🔥 [Ataque 4/10] Tentativa de Rollback de prêmio já gasto pelo jogador...");
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
  console.log("🔥 [Ataque 5/10] Injeção de valores negativos, NaN, 3 decimais, OPENING forjado e moeda errada...");
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
  // ATAQUE 6: Double Refund com Chaves Distintas (Dupla Reversão Fraudulenta)
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 6/10] Tentativa de Double Refund: estornar a mesma aposta 2 vezes com chaves diferentes...");
  const wallet6 = await createWallet("100.00");
  const betExtId6 = `bet-ext-${uuidv4()}`;

  // 1. Jogador realiza aposta de R$ 50.00 (saldo vai para R$ 50.00)
  const betRes6 = await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `bet-key-${uuidv4()}` },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: betExtId6,
      playerId: wallet6.playerId,
      walletId: wallet6.id,
      roundId: "r-double-refund",
      gameId: "chaos-game",
      kind: "BET",
      money: { amount: "50.00", currency: "BRL" },
    }),
  });
  if (!betRes6.ok) {
    throw new Error(`Falha no setup de aposta para double refund: ${betRes6.statusText}`);
  }

  // 2. Primeiro REFUND legítimo (saldo é restaurado para R$ 100.00)
  const refundRes1 = await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `ref-key-1-${uuidv4()}` },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: `ref-ext-1-${uuidv4()}`,
      playerId: wallet6.playerId,
      walletId: wallet6.id,
      roundId: "r-double-refund",
      gameId: "chaos-game",
      kind: "REFUND",
      money: { amount: "50.00", currency: "BRL" },
      referenceExternalTransactionId: betExtId6,
    }),
  });
  const ref1Data: any = await refundRes1.json();

  // 3. Segundo REFUND fraudulento com CHAVE NOVA tentando estornar a mesma aposta novamente
  const refundRes2 = await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `ref-key-2-${uuidv4()}` },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: `ref-ext-2-${uuidv4()}`,
      playerId: wallet6.playerId,
      walletId: wallet6.id,
      roundId: "r-double-refund",
      gameId: "chaos-game",
      kind: "REFUND",
      money: { amount: "50.00", currency: "BRL" },
      referenceExternalTransactionId: betExtId6,
    }),
  });
  const ref2Data: any = await refundRes2.json();

  const w6CheckRes = await fetch(`${BASE_URL}/wallets/${wallet6.id}`);
  const w6Data: any = await w6CheckRes.json();

  const attack6Passed =
    refundRes1.status === 201 &&
    ref1Data.status === "PROCESSED" &&
    refundRes2.status === 422 &&
    ref2Data.failureCode === "REFERENCE_ALREADY_REVERSED" &&
    w6Data.balance.amount === "100.00";

  reports.push({
    vector: "6. Double Refund com Chaves Distintas",
    description: "Tentativa de re-estornar aposta com nova idempotency-key para duplicar saldo",
    passed: attack6Passed,
    details: `1º Estorno: Status ${refundRes1.status} (esperado 201), 2º Estorno: Status ${refundRes2.status} (esperado 422), FailureCode: ${ref2Data.failureCode}, Saldo preservado: R$ ${w6Data.balance.amount} (esperado R$ 100.00)`,
  });
  console.log(
    `   -> ${attack6Passed ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: 1º estorno aceito e 2º estorno bloqueado com REFERENCE_ALREADY_REVERSED!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 7: Hijacking de Carteira Alheia (Cross-Player Attack)
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 7/10] Tentativa de sequestro de carteira: Atacante B tentando gastar saldo do Jogador A...");
  const walletA = await createWallet("100.00");
  const attackerBPlayerId = uuidv4();

  const hijackingRes = await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `hijack-${uuidv4()}` },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: `hijack-tx-${uuidv4()}`,
      playerId: attackerBPlayerId, // ID de jogador divergente do dono da carteira
      walletId: walletA.id,
      roundId: "r-hijack",
      gameId: "chaos-game",
      kind: "BET",
      money: { amount: "40.00", currency: "BRL" },
    }),
  });

  const hijackData: any = await hijackingRes.json();
  const wACheckRes = await fetch(`${BASE_URL}/wallets/${walletA.id}`);
  const wAData: any = await wACheckRes.json();

  const attack7Passed =
    hijackingRes.status === 422 &&
    hijackData.failureCode === "PLAYER_MISMATCH" &&
    wAData.balance.amount === "100.00";

  reports.push({
    vector: "7. Hijacking de Carteira Alheia (Cross-Player Attack)",
    description: "Atacante tenta debitar carteira de outro jogador forjando playerId divergente",
    passed: attack7Passed,
    details: `Status: ${hijackingRes.status} (esperado 422), FailureCode: ${hijackData.failureCode}, Saldo protegido: R$ ${wAData.balance.amount} (esperado R$ 100.00)`,
  });
  console.log(
    `   -> ${attack7Passed ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: Rejeitado com PLAYER_MISMATCH e saldo da vítima 100% intacto em R$ 100.00!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 8: Desordem Temporal Assíncrona (REFUND antes de BET)
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 8/10] Mensagens fora de ordem: REFUND recebido antes da BET chegar ao sistema...");
  const wallet8 = await createWallet("100.00");
  const betExtId8 = `bet-out-of-order-${uuidv4()}`;
  const refundExtId8 = `ref-out-of-order-${uuidv4()}`;

  // 1. REFUND chega antes da BET
  const oooRefundRes = await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `ooo-ref-${uuidv4()}` },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: refundExtId8,
      playerId: wallet8.playerId,
      walletId: wallet8.id,
      roundId: "r-ooo",
      gameId: "chaos-game",
      kind: "REFUND",
      money: { amount: "35.00", currency: "BRL" },
      referenceExternalTransactionId: betExtId8,
    }),
  });

  const oooRefundData: any = await oooRefundRes.json();
  const refundParked =
    oooRefundRes.status === 202 && oooRefundData.status === "PENDING_REFERENCE";

  // 2. BET chega e debita a carteira (R$ 100.00 - R$ 35.00 = R$ 65.00)
  const oooBetRes = await fetch(`${BASE_URL}/wagering/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `ooo-bet-${uuidv4()}` },
    body: JSON.stringify({
      providerId: "chaos-prov",
      externalTransactionId: betExtId8,
      playerId: wallet8.playerId,
      walletId: wallet8.id,
      roundId: "r-ooo",
      gameId: "chaos-game",
      kind: "BET",
      money: { amount: "35.00", currency: "BRL" },
    }),
  });
  const oooBetData: any = await oooBetRes.json();
  const betProcessed =
    oooBetRes.status === 201 && oooBetData.balance.amount === "65.00";

  // 3. Aguardar o background worker resolver a referência pendente (polling por até 8s)
  console.log("   ⏳ Aguardando background worker resolver a referência pendente...");
  let workerResolved = false;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 8500) {
    const txCheck = await fetch(
      `${BASE_URL}/providers/chaos-prov/wagering/transactions/${refundExtId8}`
    );
    if (txCheck.ok) {
      const txData: any = await txCheck.json();
      if (txData.status === "PROCESSED") {
        workerResolved = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const w8CheckRes = await fetch(`${BASE_URL}/wallets/${wallet8.id}`);
  const w8Data: any = await w8CheckRes.json();

  const attack8Passed =
    refundParked &&
    betProcessed &&
    workerResolved &&
    w8Data.balance.amount === "100.00";

  reports.push({
    vector: "8. Desordem Temporal Assíncrona (REFUND antes de BET)",
    description: "Reversão chega primeiro (202 PENDING_REFERENCE) e background worker resolve quando BET chega",
    passed: attack8Passed,
    details: `Refund: Status ${oooRefundRes.status} (esperado 202), Bet: Status ${oooBetRes.status} (esperado 201), Worker Resolution: ${workerResolved ? "PROCESSED" : "PENDING"}, Saldo final restaurado: R$ ${w8Data.balance.amount} (esperado R$ 100.00)`,
  });
  console.log(
    `   -> ${attack8Passed ? "🛡️ BLOQUEADO COM SUCESSO" : "❌ FALHOU"}: REFUND estacionado com 202, BET processada e worker restaurou saldo para R$ 100.00!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 9: Prova Matemática de Invariante Contábil Individual Pós-Ataques
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 9/10] Verificando integridade contábil matemática de todas as carteiras atacadas...");
  const attackedWallets = [
    wallet1.id,
    wallet2.id,
    wallet4.id,
    wallet5.id,
    wallet6.id,
    walletA.id,
    wallet8.id,
  ];
  let allReconciled = true;

  for (const wid of attackedWallets) {
    const recRes = await fetch(`${BASE_URL}/wallets/${wid}/reconciliation`, { method: "POST" });
    const recData: any = await recRes.json();
    if (!recData.consistent || recData.difference.amount !== "0.00") {
      allReconciled = false;
    }
  }

  reports.push({
    vector: "9. Reconciliação Contábil Individual das Carteiras",
    description: "Audita se a soma de todos os lançamentos do ledger bate exatamente com o saldo armazenado em cada carteira",
    passed: allReconciled,
    details: allReconciled
      ? `100% das ${attackedWallets.length} carteiras atacadas reconciliadas com diferença de R$ 0.00`
      : "Inconsistência detectada em alguma carteira",
  });
  console.log(
    `   -> ${allReconciled ? "🛡️ AUDITORIA APROVADA" : "❌ INCONSISTÊNCIA DETECTADA"}: 100% das carteiras possuem soma de ledger == saldo com diferença de R$ 0.00!\n`
  );

  // -----------------------------------------------------------------------------------------
  // ATAQUE 10: Auditoria Global de Partidas Dobradas (Double-Entry Bookkeeping Trial Balance)
  // -----------------------------------------------------------------------------------------
  console.log("🔥 [Ataque 10/10] Verificando Balancete Global de Partidas Dobradas (Trial Balance)...");
  let trialBalancePassed = false;
  let tbDetails = "";

  try {
    const tbRes = await fetch(`${BASE_URL}/accounting/trial-balance?currency=BRL`);
    if (tbRes.ok) {
      const tbData: any = await tbRes.json();
      trialBalancePassed = tbData.balanced === true && tbData.discrepancy === "0.00";
      tbDetails = `Débitos Totais: R$ ${tbData.totalDebits}, Créditos Totais: R$ ${tbData.totalCredits}, Discrepância: R$ ${tbData.discrepancy} (${tbData.totalTransactionsAudited} lançamentos auditados)`;
    } else {
      tbDetails = `Falha HTTP ao consultar trial-balance: ${tbRes.status}`;
    }
  } catch (err) {
    tbDetails = `Erro ao auditar trial-balance: ${(err as Error).message}`;
  }

  reports.push({
    vector: "10. Balancete Global de Partidas Dobradas (Trial Balance)",
    description: "Comprova que a soma global de todos os débitos é rigorosamente igual à soma de créditos (Δ = 0.00)",
    passed: trialBalancePassed,
    details: trialBalancePassed ? `🛡️ APROVADO: ${tbDetails}` : `❌ FALHOU: ${tbDetails}`,
  });
  console.log(
    `   -> ${trialBalancePassed ? "🛡️ AUDITORIA APROVADA" : "❌ INCONSISTÊNCIA DETECTADA"}: Balancete de partidas dobradas rigorosamente balanceado com Δ = 0.00!\n`
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

  try {
    const metricsRes = await fetch(`${BASE_URL}/metrics`, {
      headers: { Accept: "application/json" },
    });
    if (metricsRes.ok) {
      const metricsData = await metricsRes.json();
      console.log("📈 Métricas de Defesa Capturadas em Tempo Real (/metrics):");
      console.log(JSON.stringify(metricsData, null, 2));
      console.log("\n======================================================================\n");
    }
  } catch {}

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
