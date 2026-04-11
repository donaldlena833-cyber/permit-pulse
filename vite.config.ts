import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseAnonKey) {
  throw new Error("VITE_SUPABASE_ANON_KEY is required at build time. Put it in .env.local or export it before running Vite.");
}

export default defineConfig({
  plugins: [react()],
  define: {
    __PERMIT_PULSE_WORKER_URL__: JSON.stringify(
      process.env.PERMIT_PULSE_WORKER_URL || "https://permit-pulse-scanner.donaldlena833.workers.dev",
    ),
    __SUPABASE_URL__: JSON.stringify(
      process.env.VITE_SUPABASE_URL || "https://qiembeiwyrtwxlmvssxj.supabase.co",
    ),
    __SUPABASE_ANON_KEY__: JSON.stringify(supabaseAnonKey),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
