// Scaffolded by codd greenfield (create-only). Collection include must
// cover the .e2e.* e2e convention, not just vitest's default .test/.spec.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "**/*.{test,spec}.{ts,tsx,cts,mts,js,jsx,cjs,mjs}",
      "**/*.e2e.{ts,tsx,cts,mts,js,jsx,cjs,mjs}",
    ],
  },
});
