import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    root: path.resolve(__dirname),
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
