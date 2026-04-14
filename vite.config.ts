import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Шире поддержка мобильного Safari / старых iOS (иначе парсер падает на «новом» синтаксисе).
    target: ["es2019", "safari13", "ios13"],
    rollupOptions: {
      output: {
        // Stable entry filename allows fallback redirects for stale cached HTML.
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/chunk-[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
