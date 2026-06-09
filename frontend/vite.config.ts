import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const enablePwa = env.VITE_ENABLE_PWA !== "false";

  return {
    plugins: [
      react(),
      VitePWA({
        disable: !enablePwa,
        strategies: "injectManifest",
        srcDir: "src/workers",
        filename: "serviceWorker.ts",
        registerType: "prompt",
        includeAssets: ["favicon.svg", "icons/pwa.svg"],
        manifest: {
          name: "FieldTrix Media Delivery System",
          short_name: "FieldTrix",
          description: "Offline media delivery management for FieldTrix.",
          theme_color: "#111827",
          background_color: "#ffffff",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "/icons/pwa.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable"
            }
          ]
        },
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
        }
      })
    ],
    server: {
      port: 5173,
      strictPort: false
    }
  };
});
