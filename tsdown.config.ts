import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  dts: false,
  outDir: 'dist',
  clean: true,
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  deps: {
    alwaysBundle: [
      '@nerima-games/mc-physics',
      '@nerima-games/mc-save',
      '@nerima-games/mc-worldgen',
    ],
    dts: {
      neverBundle: true,
    },
  },
})
