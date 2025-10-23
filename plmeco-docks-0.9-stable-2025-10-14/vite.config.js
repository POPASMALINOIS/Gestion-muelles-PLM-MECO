import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 🧩 Configuración completa para Vite + React + GitHub Pages
export default defineConfig({
  // 👇 base debe coincidir exactamente con el nombre del repositorio
  base: '/Gestion-muelles-PLM-MECO/',

  // Plugin de React (usa JSX, hooks, fast refresh, etc.)
  plugins: [react()],

  // Alias para importar más limpio: "@/components/..." → "src/components/..."
  resolve: {
    alias: {
      '@': '/src',
    },
  },

  // Configuración opcional recomendada para builds limpios y predecibles
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
  },

  // Server de desarrollo local
  server: {
    port: 5173,
    open: true, // abre automáticamente en el navegador
  },
})
