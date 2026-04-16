import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const openDotaApiKey = (env.OPENDOTA_API_KEY ?? "").trim();
  const openDotaApiBase = (env.VITE_OPENDOTA_API_BASE ?? "").trim();
  if (mode === "production" && !openDotaApiBase) {
    console.warn(
      "[vite] VITE_OPENDOTA_API_BASE пуст — в бандле не будет URL из .env; на dota2next.pro / *.website.yandexcloud.net в opendota.ts есть встроенный fallback на API Gateway."
    );
  }

  function rewriteOpenDotaProxyPath(pathWithQuery: string): string {
    let p = pathWithQuery.replace(/^\/api\/od/, "/api");
    if (openDotaApiKey && !/[?&]api_key=/.test(p)) {
      p += p.includes("?") ? "&" : "?";
      p += `api_key=${encodeURIComponent(openDotaApiKey)}`;
    }
    return p;
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        // Локально: /api/od → api.opendota.com/api; ключ подставляется только здесь (не в бандл).
        "/api/od": {
          target: "https://api.opendota.com",
          changeOrigin: true,
          rewrite: rewriteOpenDotaProxyPath
        }
      }
    },
    build: {
      target: ["es2019", "safari13", "ios13"],
      rollupOptions: {
        output: {
          // Хеш сбрасывает долгий CDN-кэш при каждом деплое (иначе /assets/app.js мог годами отдавать старую логику).
          entryFileNames: "assets/app-[hash].js",
          chunkFileNames: "assets/chunk-[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    }
  };
});
