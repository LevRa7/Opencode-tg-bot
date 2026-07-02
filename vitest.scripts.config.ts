import { defineConfig } from "vitest/config";

// Lightweight config for scripts/ tests — avoids the heavy global setup in vitest.config.ts
export default defineConfig({
  test: {
    include: ["tests/scripts/update-all.test.ts"],
    environment: "node",
    passWithNoTests: true,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
  },
});
