import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:3000",
      "/admin": "http://localhost:3000",
      "/sessions": "http://localhost:3000",
      "/session-series": "http://localhost:3000",
      "/bookings": "http://localhost:3000",
      "/teacher": "http://localhost:3000",
      "/notifications": "http://localhost:3000",
      "/audit-logs": "http://localhost:3000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./test/setup.ts",
    css: true,
  },
});
