import { MikroORM } from "@mikro-orm/postgresql";
import config from "../src/infrastructure/database/mikro-orm.config";

async function run() {
  const action = process.argv[2] || "up";
  const orm = await MikroORM.init(config);
  const migrator = orm.migrator;

  if (action === "up") {
    console.log("Running pending migrations...");
    const migrations = await migrator.up();
    console.log(`Executed ${migrations.length} migration(s).`);
  } else if (action === "down") {
    console.log("Reverting last migration...");
    await migrator.down();
    console.log("Migration reverted successfully.");
  } else {
    console.error(`Unknown migration action: ${action}`);
    process.exit(1);
  }

  await orm.close();
}

run().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});

