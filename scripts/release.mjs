/** Cuts a release for the plugin or the browser extension.
 *
 * Both ship from this repo but to different places on different cadences, so
 * they carry independent versions and independent tags:
 *
 *   plugin     0.0.3                    -> release.yml -> GitHub draft release
 *   extension  statblock-clipper-v0.1.0 -> statblock-clipper-release.yml
 *                                          -> GitHub release + AMO + Web Store
 *
 * Usage:
 *   node scripts/release.mjs plugin    <patch|minor|major|x.y.z>
 *   node scripts/release.mjs extension <patch|minor|major|x.y.z>
 *
 * Pass --dry-run to see every step without touching the repo, and --no-push to
 * stop after tagging. The push is what starts the workflow, so without it
 * nothing is published and the tag can still be deleted locally.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CLIPPER_DIR = 'tools/daggerheart-statblock-clipper';

const TARGETS = {
    plugin: {
        cwd: '.',
        tag: (version) => version,
        // version-bump.mjs runs from npm's `version` hook and syncs
        // manifest.json and versions.json.
        verify: ['run lint', 'run build'],
        files: ['CHANGELOG.md', 'manifest.json', 'package.json', 'versions.json'],
        // release.yml builds its notes from this section and fails without it.
        // Checking here turns that into a local error before the tag exists.
        changelog: true,
    },
    extension: {
        cwd: CLIPPER_DIR,
        tag: (version) => `statblock-clipper-v${version}`,
        // The clipper's manifests are generated at build time from its
        // package.json, so there is nothing else to keep in step.
        verify: ['run typecheck', 'test', 'run build', 'run validate'],
        files: [`${CLIPPER_DIR}/package.json`],
    },
};

const [target, bump, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
const noPush = flags.includes('--no-push') || dryRun;

if (!TARGETS[target] || !bump) {
    console.error(
        'Usage: node scripts/release.mjs <plugin|extension> <patch|minor|major|x.y.z> [--dry-run] [--no-push]',
    );
    process.exit(2);
}

const config = TARGETS[target];

function run(command, args, { cwd = '.', capture = false } = {}) {
    const shown = `${command} ${args.join(' ')}`;
    if (dryRun && !capture) {
        console.log(`  [dry-run] ${cwd === '.' ? '' : `(${cwd}) `}${shown}`);
        return '';
    }
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
}

// A dirty tree would sweep unrelated edits into the release commit.
const status = run('git', ['status', '--porcelain'], { capture: true }).trim();
if (status) {
    console.error('The working tree has uncommitted changes:\n' + status);
    console.error('\nCommit or stash them first — a release commit should contain only the version bump.');
    process.exit(1);
}

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).trim();
if (branch !== 'main') {
    console.error(`Releases are cut from main; you are on "${branch}".`);
    process.exit(1);
}

console.log(`\n== Verifying ${target} ==`);
for (const script of config.verify) {
    run('npm', script.split(' '), { cwd: config.cwd });
}

console.log(`\n== Bumping ${target} version ==`);
// `npm version` writes package.json, fires the `version` hook (the plugin uses
// it to sync manifest.json and versions.json), and commits. --no-git-tag-version
// keeps tag naming here, where the extension needs its own prefix.
run('npm', ['version', bump, '--no-git-tag-version'], { cwd: config.cwd });

const pkgPath = resolve(config.cwd, 'package.json');
const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const tag = config.tag(version);

// Under --dry-run the bump above never ran, so this is the *current* version,
// not the one a real run would produce. Say so rather than looking authoritative.
if (dryRun) console.log(`\n  (dry-run: version unchanged, so the tag below reflects ${version}, not the ${bump} bump)`);

// The bump has happened, so this is the version the release will carry.
if (config.changelog && !dryRun) {
    try {
        execFileSync('node', ['scripts/changelog-section.mjs', version], { stdio: 'pipe' });
    } catch {
        const paths = config.files.join(' ');
        console.error(`\nCHANGELOG.md has no section for ${version}.`);
        console.error('Add one under `## [Unreleased]`, rename that heading, then re-run.');
        // version-bump.mjs stages what it rewrites, so unstage before checkout.
        console.error(`\nThe version bump is applied and partly staged; undo it with:`);
        console.error(`  git reset HEAD ${paths} && git checkout ${paths}`);
        process.exit(1);
    }
}

console.log(`\n== Committing and tagging ${tag} ==`);
run('git', ['add', ...config.files]);
run('git', ['commit', '-m', `Release ${tag}`]);
run('git', ['tag', '-a', tag, '-m', `Release ${tag}`]);

if (noPush) {
    console.log(`\nStopped before pushing. Nothing is published yet.`);
    console.log(`  Push:   git push origin main && git push origin ${tag}`);
    console.log(`  Undo:   git tag -d ${tag} && git reset --hard HEAD~1`);
} else {
    console.log(`\n== Pushing ==`);
    run('git', ['push', 'origin', 'main']);
    run('git', ['push', 'origin', tag]);
    console.log(`\nPushed ${tag}. The workflow will build and draft the release.`);
}
