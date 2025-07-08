import esbuild from 'esbuild';
import process from 'process';
import fs from 'fs';
import path from 'path';

const isProduction = process.argv[2] === 'production';

const commonConfig = {
    entryPoints: ["./src/main.ts", "./src/styles.css"],
    bundle: true,
    external: ['obsidian'],
    format: 'cjs',
    target: 'es2020',
    outdir: './',
    logLevel: 'info',
    sourcemap: isProduction ? false : 'inline',
    treeShaking: true,
};

if (isProduction) {
    // Production build: just build once
    esbuild.build(commonConfig).catch(() => process.exit(1));
} else {
    // Development build: use context and watch for continuous rebuilding
    esbuild.context(commonConfig).then(ctx => {
        ctx.watch();
        console.log('Watching for changes...');
    }).catch(() => process.exit(1));
}
