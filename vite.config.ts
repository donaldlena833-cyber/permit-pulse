import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    __PERMIT_PULSE_WORKER_URL__: JSON.stringify(
      process.env.PERMIT_PULSE_WORKER_URL || "https://permit-pulse-scanner.donaldlena833.workers.dev",
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
