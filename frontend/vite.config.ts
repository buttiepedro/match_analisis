import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/auth": "http://localhost:8000",
      "/health": "http://localhost:8000",
      "/clubs": "http://localhost:8000",
      "/players": "http://localhost:8000",
      "/sessions": "http://localhost:8000",
      "/tournaments": "http://localhost:8000",
      "/divisions": "http://localhost:8000",
      "/import": "http://localhost:8000",
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
});
