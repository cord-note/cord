import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/sidecar/db/schema.ts',
  out: './src/sidecar/db/migrations',
  dialect: 'sqlite',
})
