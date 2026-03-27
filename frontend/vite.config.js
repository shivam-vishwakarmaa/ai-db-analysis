import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Load env vars from project root so frontend and Python share a single .env
  envDir: "..",
  plugins: [react(), tailwindcss()],
});
