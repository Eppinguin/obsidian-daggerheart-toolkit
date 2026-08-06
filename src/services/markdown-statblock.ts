/**
 * Locating and rewriting `daggerheart-statblock` blocks inside notes.
 *
 * The loader and the writer must agree exactly on which block is which, so both
 * go through `findStatblockBlocks`. Anything else in the note — prose, other
 * code blocks, frontmatter — is preserved untouched by a rewrite.
 */

/** One fenced statblock block, with the offsets of its YAML body. */
export interface StatblockBlock {
    /** Position among the statblock blocks in this file, 0-based. */
    index: number;
    /** Offsets of the YAML body, excluding the fences themselves. */
    bodyStart: number;
    bodyEnd: number;
    body: string;
}

const BLOCK_PATTERN = /(```+)daggerheart-statblock[ \t]*\r?\n([\s\S]*?)\r?\n?\1/g;

/** Every statblock block in a note, in document order. */
export function findStatblockBlocks(content: string): StatblockBlock[] {
    const blocks: StatblockBlock[] = [];
    const pattern = new RegExp(BLOCK_PATTERN.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
        const body = match[2];
        const bodyStart = match.index + match[0].indexOf(body, match[1].length);
        blocks.push({
            index: blocks.length,
            bodyStart,
            bodyEnd: bodyStart + body.length,
            body,
        });
    }
    return blocks;
}

/**
 * Replace the body of one block, leaving the rest of the note byte-identical.
 *
 * Returns null when the index does not exist, which means the note changed
 * underneath us and the caller should refuse the write rather than guess.
 */
export function replaceStatblockBlock(content: string, index: number, yaml: string): string | null {
    const blocks = findStatblockBlocks(content);
    const target = blocks[index];
    if (!target) return null;

    const body = yaml.replace(/\s+$/, '');
    return content.slice(0, target.bodyStart) + body + content.slice(target.bodyEnd);
}

/** Remove one block entirely, along with the blank lines it leaves behind. */
export function removeStatblockBlock(content: string, index: number): string | null {
    const pattern = new RegExp(BLOCK_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    let seen = 0;

    while ((match = pattern.exec(content)) !== null) {
        if (seen++ !== index) continue;
        const before = content.slice(0, match.index);
        const after = content.slice(match.index + match[0].length);

        // The removed block sat between two blank lines; keeping both would
        // leave a widening gap, so the join is normalized to one blank line.
        const joined = before.replace(/[ \t]*\r?\n\s*$/, '') + '\n\n' + after.replace(/^\s*\r?\n/, '');
        return joined
            .replace(/^\s*\n+/, '') // no leading blank lines
            .replace(/\n{3,}/g, '\n\n'); // no run of blank lines anywhere
    }
    return null;
}

/**
 * Confirm a block still holds the entry we think it does before overwriting it.
 *
 * Guards against the note having been edited since the compendium was loaded,
 * where a stale index could otherwise clobber an unrelated statblock.
 */
export function blockMatchesName(body: string, expectedName: string): boolean {
    const match = body.match(/^\s*name\s*:\s*(.+?)\s*$/m);
    if (!match) return false;
    const found = match[1]
        .replace(/^['"]|['"]$/g, '')
        .trim()
        .toLowerCase();
    return found === expectedName.trim().toLowerCase();
}
