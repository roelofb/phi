import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@contracts": new URL("./contracts", import.meta.url).pathname,
      "@src": new URL("./src", import.meta.url).pathname,
    },
  },
});
