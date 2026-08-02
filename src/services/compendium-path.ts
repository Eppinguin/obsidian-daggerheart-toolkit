export function normalizeCompendiumPath(value: string | null | undefined): string {
    return String(value ?? '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/^\/+|\/+$/g, '');
}

export function isPathInsideCompendium(candidatePath: string, configuredPath: string): boolean {
    const candidate = normalizeCompendiumPath(candidatePath);
    const configured = normalizeCompendiumPath(configuredPath);
    if (!configured || !candidate.toLowerCase().endsWith('.md')) return false;
    return candidate === configured || candidate.startsWith(`${configured}/`);
}
