import { Module } from "@nestjs/common";
import { ApplicationModule } from "./application/application.module";
import { DatabaseModule } from "./infrastructure/database/database.module";
import { MessagingModule } from "./infrastructure/messaging/messaging.module";
import { ObservabilityModule } from "./infrastructure/observability/observability.module";
import { PresentationModule } from "./presentation/presentation.module";

@Module({
  imports: [
    DatabaseModule,
    ApplicationModule,
    MessagingModule,
    ObservabilityModule,
    PresentationModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
