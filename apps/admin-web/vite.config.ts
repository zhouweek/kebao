import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/sessions": "http://localhost:3000",
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
