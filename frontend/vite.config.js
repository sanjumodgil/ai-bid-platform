import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load env from the frontend directory regardless of where vite is launched from
  const frontendDir = path.resolve(__dirname)
  const env = loadEnv(mode, frontendDir, '')

  const port   = parseInt(env.VITE_PORT   || '5180', 10)
  const apiUrl = env.VITE_API_URL          || 'http://localhost:8010'

  return {
    plugins: [react()],
    server: {
      port,
      strictPort: true,  // fail clearly if port is taken rather than silently using another
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
          secure: false,
          // No rewrite — /api/v1/... on frontend maps to /api/v1/... on backend
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  }
})
