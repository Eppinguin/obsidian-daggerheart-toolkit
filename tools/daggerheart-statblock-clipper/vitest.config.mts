import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        // The legacy IIFE tests are CommonJS and assert via side effects on
        // globalThis. Running them in a single thread keeps that global state
        // from leaking between files during the port.
        pool: 'forks',
        fileParallelism: false,
        include: ['tests/**/*.test.{js,ts}'],
        exclude: ['tests/browser/**', 'node_modules/**'],
    },
});
