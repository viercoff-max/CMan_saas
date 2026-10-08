import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // `*-live.test.ts` is reserved for tests that hit REAL Meta/Shopify/OpenAI APIs (owner approval + test credentials
  // required, see AGENTS.md). They never run in the default suite. Mocked tests are named `*-integration.test.ts`.
  test: { include: ["src/**/*.test.ts"], exclude: ["**/node_modules/**", "**/*-live.test.ts"] },
});
