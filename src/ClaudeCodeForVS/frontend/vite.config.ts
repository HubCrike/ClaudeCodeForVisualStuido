import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  // Output build artifacts directly into the VSIX-packaged wwwroot folder
  build: {
    outDir: path.resolve(__dirname, '../wwwroot'),
    emptyOutDir: false, // 不清空目录，避免删除 claude-agent
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep filenames stable so the VSIX-packaged assets don't change every build.
        entryFileNames: 'assets/app.js',
        // Avoid hash-based chunk names; keep it stable if chunks are produced.
        chunkFileNames: 'assets/chunk.js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? ''
          if (name.endsWith('.css')) {
            return 'assets/app.css'
          }
          return 'assets/[name][extname]'
        },
      },
    },
  },
})
