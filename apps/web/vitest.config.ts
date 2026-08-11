import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: {
    alias: {
      "@contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
      "lucide-react": fileURLToPath(new URL("../../node_modules/lucide-react", import.meta.url)),
      "react": fileURLToPath(new URL("../../node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(new URL("../../node_modules/react-dom", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}", "../../packages/contracts/src/**/*.ts"],
      allowExternal: true,
      exclude: ["src/env.d.ts"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
