
import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  override: true,
});

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is missing. Check the .env file in the project root.',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
