import { defineConfig, searchForWorkspaceRoot, type Alias } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * The Shuttle checkout beside this repo, if there is one.
 *
 * In dev, `shuttle-editor` resolves to its source so editor changes show up in
 * Cord immediately, without publishing a release. Builds always use the npm
 * package. Set CORD_SHUTTLE=npm to use the npm package in dev too.
 */
function localShuttle(): string | null {
  if (process.env['CORD_SHUTTLE'] === 'npm') return null
  const dir = resolve(__dirname, '../../../shuttle')
  try {
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as { name?: string }
    return pkg.name === 'shuttle-editor' && existsSync(resolve(dir, 'node_modules')) ? dir : null
  } catch {
    return null
  }
}

export default defineConfig(({ command }) => {
  const shuttle = command === 'serve' ? localShuttle() : null
  if (shuttle) console.info(`[vite] shuttle-editor → local source at ${shuttle}`)

  const aliases: Alias[] = [
    { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
    { find: '@renderer', replacement: resolve(__dirname, 'src/renderer') },
  ]
  if (shuttle) {
    aliases.push(
      { find: /^shuttle-editor\/styles\.css$/, replacement: resolve(shuttle, 'src/styles/shuttle.css') },
      { find: /^shuttle-editor\/doc$/, replacement: resolve(shuttle, 'src/doc-core/index.ts') },
      { find: /^shuttle-editor$/, replacement: resolve(shuttle, 'src/index.ts') },
    )
  }

  return {
    plugins: [react()],
    resolve: {
      alias: aliases,
      // Shuttle's source would otherwise load its own copy of React.
      dedupe: ['react', 'react-dom'],
    },
    build: {
      outDir: 'dist/renderer',
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      strictPort: true,
      fs: {
        allow: [searchForWorkspaceRoot(process.cwd()), ...(shuttle ? [shuttle] : [])],
      },
      watch: {
        // Exclude Rust build artifacts — locked .exe files on Windows cause EBUSY
        ignored: ['**/src-tauri/target/**'],
      },
    },
    // Tauri expects a static origin in dev
    clearScreen: false,
  }
})
