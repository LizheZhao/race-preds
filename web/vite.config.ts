import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

// GitHub Pages serves this project site at https://<user>.github.io/race-preds/.
// Override with BASE_PATH (e.g. "/") for another host.
export default defineConfig({
  base: process.env["BASE_PATH"] ?? "/race-preds/",
  plugins: [react(), tailwindcss(), tsconfigPaths()],
});
