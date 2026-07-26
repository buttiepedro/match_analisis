import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        /*
          El tablero de cancha no tiene por qué bajar ECharts ni `xlsx`. En una app
          cuyo argumento es funcionar con mala señal, mandar 3 MB en el primer
          request contradice el producto.
        */
        manualChunks: {
          echarts: ["echarts", "echarts-for-react"],
          xlsx: ["xlsx", "xlsx-js-style"],
          pdf: ["jspdf", "html2canvas"],
          crop: ["react-easy-crop"],
          vendor: ["react", "react-dom", "react-router-dom", "zustand", "axios"],
        },
      },
    },
  },
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
