import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, queryClient } from './client.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('Running migrations...');
  const migrationsFolder = path.resolve(__dirname, '../drizzle');
  
  await migrate(db, { migrationsFolder });
  
  console.log('Migrations complete.');
  await queryClient.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
