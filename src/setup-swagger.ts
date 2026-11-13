import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export function setupSwagger(app: INestApplication) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Distributed Wagering Processor API")
    .setDescription(
      "API transacional de alto desempenho para plataformas de iGaming com precisão monetária estrita, deduplicação transacional por idempotência (SHA-256 canônico), consistência de ledger append-only e mensageria distribuída (SQS FIFO, Transactional Inbox/Outbox)."
    )
    .setVersion("1.0.0")
    .addTag("Wallets", "Gestão de carteiras, consulta de saldo, extrato com opaque cursor e auditoria contábil")
    .addTag("Wagering Transactions", "Processamento e consulta de transações financeiras de apostas (BET, WIN, LOSS, REFUND, ROLLBACK)")
    .addTag("Accounting & Double-Entry", "Auditoria do balancete de verificação de partidas dobradas (Trial Balance)")
    .addTag("Health & Observability", "Health checks de liveness/readiness e métricas Prometheus / OpenMetrics")
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "docs-json",
  });

  return document;
}

