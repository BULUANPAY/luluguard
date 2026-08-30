import tailwindcss from "@tailwindcss/vite";
import { reactRouter } from "@react-router/dev/vite";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: path.join(import.meta.dirname, "../.."),
  plugins: [tailwindcss(), reactRouter()],
});
