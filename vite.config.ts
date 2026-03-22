import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    __PERMIT_PULSE_WORKER_URL__: JSON.stringify(
      process.env.PERMIT_PULSE_WORKER_URL || "https://permit-pulse-scanner.donaldlena833.workers.dev",
    ),
    __SUPABASE_URL__: JSON.stringify(
      process.env.VITE_SUPABASE_URL || "https://qiembeiwyrtwxlmvssxj.supabase.co",
    ),
    __SUPABASE_ANON_KEY__: JSON.stringify(
      process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpZW1iZWl3eXJ0d3hsbXZzc3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMjU5ODAsImV4cCI6MjA4OTYwMTk4MH0.JAQPIO9Fv7yLdPglbtRsqGZo-Zm1BFc8qP25sb0NP78",
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
