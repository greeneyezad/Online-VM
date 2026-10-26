import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy targets default to the local backend so `npm run dev` works unchanged.
// In containers the backend is reachable by service name instead, so
// docker-compose.base44.yml overrides these two variables.
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8000'
const wsTarget = process.env.VITE_WS_PROXY_TARGET || 'ws://localhost:8000'

// Vite blocks requests whose Host header is not an IP, localhost or an allowed
// host. The Base44 preview reaches this dev server through the sandbox's
// proxied hostname, so allow it — but only while running in the sandbox, so a
// normal local `npm run dev` keeps the original behaviour.
const allowedHosts = []
if (process.env.BASE44_PREVIEW_MODE === '1' && process.env.BASE44_SANDBOX_HOST_DOMAIN) {
  allowedHosts.push(`.${process.env.BASE44_SANDBOX_HOST_DOMAIN}`)
}

export default defineConfig({
  plugins: [react()],
  server: {
    ...(allowedHosts.length ? { allowedHosts } : {}),
    proxy: {
      '/api': apiTarget,
      '/ws': { target: wsTarget, ws: true }
    }
  }
})
