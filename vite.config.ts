import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: process.env.MICROPLATE_OFFLINE_BUILD === "1" ? {
    rolldownOptions: { output: { codeSplitting: false } },
  } : undefined,
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
  },
});
