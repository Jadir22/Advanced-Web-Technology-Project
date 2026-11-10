
import { DataSource } from "typeorm";
import { dataSourceOptions } from "../config/database.config";

async function checkDatabaseSchema(): Promise<void> {
  const dataSource = new DataSource(dataSourceOptions);

  try {
    await dataSource.initialize();

    console.log("Database connected successfully.");

    console.log(
      `Loaded Entities: ${dataSource.entityMetadatas.length}`,
    );

    const schemaBuilder = dataSource.driver.createSchemaBuilder();
    const sqlInMemory = await schemaBuilder.log();

    const differences = sqlInMemory.upQueries;

    console.log(`Schema Differences: ${differences.length}`);

    if (differences.length === 0) {
      console.log("Entity and Database schemas are consistent.");
    } else {
      console.log("Schema differences found:");

      differences.forEach((query, index) => {
        console.log(`${index + 1}. ${query.query}`);
      });
    }
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

checkDatabaseSchema().catch((error) => {
  console.error("Schema check failed:", error);
  process.exitCode = 1;
});
