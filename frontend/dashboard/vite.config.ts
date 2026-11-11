/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const BACKEND = process.env.FLIGHTOPS_BACKEND_URL ?? "http://127.0.0.1:8080";

/**
 * Strict Content-Security-Policy for production builds only (the dev server needs inline
 * scripts and websockets for hot reload). All API calls are same-origin via the /api proxy.
 */
function contentSecurityPolicy(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // charts set inline style attributes
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // frame-ancestors (clickjacking) only works as an HTTP header, not in <meta>: the web server
    // that serves dist/ must send `Content-Security-Policy: frame-ancestors 'none'` (Phase 8).
  ].join("; ");
  return {
    name: "flightops-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  // Explicit IPv4 loopback: Vite's default "localhost" can bind IPv6 (::1) only on recent Node,
  // which breaks http://127.0.0.1 links, health checks and start.bat. Local-only by design.
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: BACKEND, changeOrigin: false } },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: { "/api": { target: BACKEND, changeOrigin: false } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
