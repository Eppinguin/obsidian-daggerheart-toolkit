import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const projectRoot = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const target = mode === 'firefox' ? 'firefox' : 'chromium';
  return {
    root: projectRoot,
    publicDir: false,
    base: './',
    build: {
      target: 'es2022',
      outDir: resolve(projectRoot, 'dist', target),
      emptyOutDir: true,
      assetsDir: 'assets',
      rollupOptions: {
        input: {
          popup: resolve(projectRoot, 'popup.html'),
          options: resolve(projectRoot, 'options.html')
        },
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]'
        }
      }
    }
  };
});
