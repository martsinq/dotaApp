import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Шире поддержка мобильного Safari / старых iOS (иначе парсер падает на «новом» синтаксисе).
    target: ["es2019", "safari13", "ios13"]
  }
});
