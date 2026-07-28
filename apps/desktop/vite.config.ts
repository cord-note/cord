import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Exclude Rust build artifacts — locked .exe files on Windows cause EBUSY
      ignored: ['**/src-tauri/target/**'],
    },
  },
  // Tauri expects a static origin in dev
  clearScreen: false,
})
