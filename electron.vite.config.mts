import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Entry points follow electron-vite defaults:
//   src/main/index.ts, src/preload/index.ts, src/renderer/index.html
export default defineConfig({
  main: {},
  preload: {
    build: {
      // Sandboxed preload scripts must be CommonJS.
      rollupOptions: { output: { format: 'cjs' } }
    }
  },
  renderer: {
    plugins: [react()]
  }
})
