import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ApplicationModule } from "../application/application.module";
import {
  NoopProviderIdentityService,
  ProviderIdentityPort,
} from "../application/ports/provider-identity.port";
import { DatabaseModule } from "../infrastructure/database/database.module";
import { MessagingModule } from "../infrastructure/messaging/messaging.module";
import { ObservabilityModule } from "../infrastructure/observability/observability.module";
import { HealthController } from "./controllers/health.controller";
import { MetricsController } from "./controllers/metrics.controller";
import { ProviderWageringTransactionsController } from "./controllers/provider-wagering-transactions.controller";
import { ReconciliationController } from "./controllers/reconciliation.controller";
import { WageringTransactionsController } from "./controllers/wagering-transactions.controller";
import { WalletsController } from "./controllers/wallets.controller";
import { ProviderAuthGuard } from "./guards/provider-auth.guard";
import { CorrelationIdMiddleware } from "./middleware/correlation-id.middleware";

@Module({
  imports: [
    DatabaseModule,
    ApplicationModule,
    MessagingModule,
    ObservabilityModule,
  ],
  controllers: [
    WalletsController,
    WageringTransactionsController,
    ProviderWageringTransactionsController,
    ReconciliationController,
    HealthController,
    MetricsController,
  ],
  providers: [
    {
      provide: ProviderIdentityPort,
      useClass: NoopProviderIdentityService,
    },
    {
      provide: APP_GUARD,
      useClass: ProviderAuthGuard,
    },
  ],
})
export class PresentationModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}

