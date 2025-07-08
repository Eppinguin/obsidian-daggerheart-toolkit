import esbuild from 'esbuild';
import process from 'process';
import fs from 'fs';
import path from 'path';

const isProduction = process.argv[2] === 'production';

// Plugin to copy data folder to build directory
const copyDataPlugin = {
    name: 'copy-data-files',
    setup(build) {
        build.onEnd(() => {
            // Define the source and target directories
            const dataDir = 'data';
            const targetDir = 'data';
            const userCompendiumDir = 'user_compendium';
            
            // Create target directories if they don't exist
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            if (!fs.existsSync(userCompendiumDir)) {
                fs.mkdirSync(userCompendiumDir, { recursive: true });
            }
            
            // Copy all files from data directory
            if (fs.existsSync(dataDir)) {
                const files = fs.readdirSync(dataDir);
                for (const file of files) {
                    const srcPath = path.join(dataDir, file);
                    const destPath = path.join(targetDir, file);
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`Copied: ${srcPath} → ${destPath}`);
                }
            } else {
                console.warn(`Data directory ${dataDir} does not exist`);
            }
        });
    }
};

const commonConfig = {
    entryPoints: ['main.ts'],
    bundle: true,
    external: ['obsidian'],
    format: 'cjs',
    target: 'es2018',
    outfile: 'main.js',
    logLevel: 'info',
    sourcemap: isProduction ? false : 'inline',
    treeShaking: true,
    plugins: [copyDataPlugin],
    loader: {
        '.css': 'text',  // Handle CSS files as text
    },
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
