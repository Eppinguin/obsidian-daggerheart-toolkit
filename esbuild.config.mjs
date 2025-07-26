import esbuild from 'esbuild';
import process from 'process';
import fs from 'fs';
import path from 'path';
import peggy from 'peggy';

const isProduction = process.argv[2] === 'production';

const peggyPlugin = {
  name: "peggy",
  setup(build) {
    build.onLoad({ filter: /\.pegjs$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, "utf8");
      const parser = peggy.generate(source, {
        output: "source",
        format: "es",
      });
      return {
        contents: parser,
        loader: "js",
      };
    });
  },
};

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
    plugins: [peggyPlugin],
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
