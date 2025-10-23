// vite.config.js (corregido)
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/Gestion-muelles-PLM-MECO/',   // 👈 nombre exacto del repo
  plugins: [react()],
  resolve: { alias: { '@': '/src' } },
})
