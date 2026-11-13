import { Migrator } from "@mikro-orm/migrations";
import { defineConfig, PostgreSqlDriver } from "@mikro-orm/postgresql";
import * as entities from "./entities";

export default defineConfig({
  driver: PostgreSqlDriver,
  clientUrl:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/wagering_db",
  entities: Object.values(entities),
  extensions: [Migrator],
  migrations: {
    path: "./dist/src/infrastructure/database/migrations",
    pathTs: "./src/infrastructure/database/migrations",
    tableName: "mikro_orm_migrations",
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
  },
  pool: {
    min: 2,
    max: 20,
  },
  debug: false,
});

