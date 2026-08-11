import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  integrations: [react()],
  output: "static",
  vite: {
    resolve: {
      alias: {
        "@contracts": fileURLToPath(
          new URL("../../packages/contracts/src/index.ts", import.meta.url),
        ),
      },
    },
    server: {
      proxy: {
        "/api": "http://127.0.0.1:8787",
      },
    },
  },
});
