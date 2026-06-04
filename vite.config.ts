import { defineConfig } from "vite";

export default defineConfig({
  base: "/buyopoyo/",
  server: {
    host: true, // LAN公開（iPhone実機テスト用）
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
