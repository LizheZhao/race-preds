import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Tests run with the real app config, including the GitHub Pages base path.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  }),
);
