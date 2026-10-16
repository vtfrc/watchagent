import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    main: './src/index.ts',
    miniflare: {
      compatibilityDate: '2026-10-14',
      compatibilityFlags: ['global_fetch_strictly_public'],
      d1Databases: ['DB'],
      bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') }
    }
  }))],
  test: { include: ['test/**/*.test.ts'] }
});
