import { RequestContext } from "@mikro-orm/core";
import { EntityManager, MikroORM } from "@mikro-orm/postgresql";
import {
  Global,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnModuleDestroy,
} from "@nestjs/common";
import config from "./mikro-orm.config";

@Global()
@Module({
  providers: [
    {
      provide: MikroORM,
      useFactory: async () => {
        return await MikroORM.init(config);
      },
    },
    {
      provide: EntityManager,
      useFactory: (orm: MikroORM) => {
        return orm.em;
      },
      inject: [MikroORM],
    },
  ],
  exports: [MikroORM, EntityManager],
})
export class DatabaseModule implements NestModule, OnModuleDestroy {
  constructor(private readonly orm: MikroORM) {}

  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((_req: any, _res: any, next: () => void) => {
        RequestContext.create(this.orm.em, next);
      })
      .forRoutes("*");
  }

  public async onModuleDestroy(): Promise<void> {
    await this.orm.close();
  }
}

