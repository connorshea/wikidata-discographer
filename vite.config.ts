import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

// The client is built to dist/client and, in production, served by the Hono
// server (server/index.ts). In dev, Vite serves the SPA and proxies /api to the
// Node server on :8000.
export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    // drizzle-kit rewrites its migration metadata on every generate.
    ignorePatterns: ["db/migrations/"],
  },
  lint: {
    plugins: ["react", "typescript", "oxc", "import"],
    categories: { correctness: "error" },
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "vite-plus/prefer-vite-plus-imports": "error",
      // Node's type-stripping needs explicit extensions on relative imports.
      "import/extensions": [
        "error",
        "ignorePackages",
        { ts: "always", tsx: "always", js: "always", jsx: "always" },
      ],
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.PORT ?? 8000}`,
        changeOrigin: true,
      },
    },
  },
  plugins: lazyPlugins(() => [react()]),
});
