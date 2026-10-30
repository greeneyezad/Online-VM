import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In the Base44 sandbox the preview proxy forwards a rotated Host header and the
// browser sends the public preview Origin, so both are allowlisted only while
// BASE44_PREVIEW_MODE is exactly "1". Unset (normal local dev) keeps Vite defaults.
const previewHosts = []
if (process.env.BASE44_PREVIEW_MODE === '1') {
  if (process.env.BASE44_SANDBOX_HOST_DOMAIN) {
    previewHosts.push(`.${process.env.BASE44_SANDBOX_HOST_DOMAIN}`)
  }
  if (process.env.BASE44_PUBLIC_HOST_SUFFIX) {
    previewHosts.push(
      process.env.BASE44_PUBLIC_HOST_SUFFIX,
      `.${process.env.BASE44_PUBLIC_HOST_SUFFIX}`
    )
  }
}

// The API lives in a separate compose service in the sandbox; locally it stays
// on localhost:8000 (the original behavior).
const backendOrigin = process.env.BACKEND_ORIGIN || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: previewHosts.length ? previewHosts : undefined,
    proxy: {
      '/api': backendOrigin,
      '/ws': { target: backendOrigin.replace(/^http/, 'ws'), ws: true }
    }
  }
})
