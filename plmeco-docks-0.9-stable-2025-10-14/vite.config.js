import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/Gestion-muelles-PLM-MECO/', // 👈 exacto, con mayúsculas y guiones
  plugins: [react()],
})
