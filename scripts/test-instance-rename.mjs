import assert from 'node:assert/strict';
import fs from 'node:fs';

const viewSource = fs.readFileSync('src/views/EncounterBuilderView.ts', 'utf8');

/**
 * Executes the real updateDisplayNamesForGroup() body rather than a copy of it,
 * so that weakening the guard in the view actually fails this test.
 *
 * The numbering is a default: it must not overwrite a name the GM set
 * deliberately, or renaming an instance would be silently undone the next time
 * the group gains or loses a member.
 */
function extractRenumberLogic() {
    const start = viewSource.indexOf('private updateDisplayNamesForGroup(groupId: string) {');
    assert.ok(start > -1, 'updateDisplayNamesForGroup not found in the view');
    const body = viewSource.slice(start, viewSource.indexOf('\n    }', start));
    // Reduce the method body to something runnable: the group is passed in
    // rather than filtered off view state.
    const runnable = body
        .slice(body.indexOf('{') + 1)
        .replace(/const instancesInThisGroup = this\.activeEncounterItems[^;]*;/, '')
        .replace(/instancesInThisGroup/g, 'group');
    return new Function('group', runnable + '\n return group;');
}

const renumber = extractRenumberLogic();

function updateDisplayNames(group) {
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    renumber(sorted);
    return sorted;
}

const mk = (id, name = 'Shadow Hag', extra = {}) => ({ id, name, displayName: name, ...extra });

// Baseline numbering still applies to untouched instances.
let group = updateDisplayNames([mk('a'), mk('b'), mk('c')]);
assert.deepEqual(
    group.map((i) => i.displayName),
    ['Shadow Hag #1', 'Shadow Hag #2', 'Shadow Hag #3'],
);

// A renamed instance keeps its name when the group grows.
group = [mk('a'), mk('b', 'Shadow Hag', { displayName: 'The one on the roof', hasCustomName: true })];
group.push(mk('c'));
group = updateDisplayNames(group);
assert.equal(
    group.find((i) => i.id === 'b').displayName,
    'The one on the roof',
    'a custom name must survive the group gaining a member',
);
assert.equal(group.find((i) => i.id === 'a').displayName, 'Shadow Hag #1');
assert.equal(group.find((i) => i.id === 'c').displayName, 'Shadow Hag #3');

// ...and when the group shrinks to one, where numbering is dropped entirely.
group = updateDisplayNames([mk('b', 'Shadow Hag', { displayName: 'Wounded', hasCustomName: true })]);
assert.equal(group[0].displayName, 'Wounded', 'a custom name must survive the group shrinking to a single member');

// An un-renamed sole survivor loses its number, as before.
group = updateDisplayNames([mk('a')]);
assert.equal(group[0].displayName, 'Shadow Hag');

// An instance must never render nameless. "Add to Group" copies an existing
// instance as its template, so a renamed member would otherwise pass
// hasCustomName on to the new copy, whose displayName is still empty.
group = updateDisplayNames([
    mk('a', 'Acid Burrower', { displayName: 'Tunneler', hasCustomName: true }),
    mk('b', 'Acid Burrower', { displayName: '', hasCustomName: true }),
    mk('c', 'Acid Burrower', { displayName: '   ', hasCustomName: true }),
]);
assert.equal(group.find((i) => i.id === 'a').displayName, 'Tunneler');
assert.equal(
    group.find((i) => i.id === 'b').displayName,
    'Acid Burrower #2',
    'an empty name must be filled in regardless of the custom-name flag',
);
assert.equal(group.find((i) => i.id === 'c').displayName, 'Acid Burrower #3', 'a whitespace-only name counts as empty');

// Numbering counts every member, so a rename does not renumber its neighbours.
group = updateDisplayNames([mk('a'), mk('b', 'Shadow Hag', { displayName: 'Renamed', hasCustomName: true }), mk('c')]);
assert.equal(
    group.find((i) => i.id === 'c').displayName,
    'Shadow Hag #3',
    'numbering must stay stable when a neighbour is renamed',
);

// Clearing the name restores the automatic one.
const cleared = mk('a', 'Shadow Hag', { displayName: 'Gone', hasCustomName: false });
assert.equal(
    updateDisplayNames([cleared, mk('b')])[0].displayName,
    'Shadow Hag #1',
    'clearing the custom-name flag restores automatic numbering',
);

// --- wiring ---
const view = viewSource;
const nameRenderer = fs.readFileSync('src/rendering/instance-name.ts', 'utf8');
const statblock = fs.readFileSync('src/rendering/statblock.ts', 'utf8');

// Both renderers use the shared editable name, so first and subsequent group
// members behave identically.
for (const [label, src] of [
    ['statblock.ts', statblock],
    ['EncounterBuilderView.ts', view],
]) {
    assert.match(src, /renderInstanceName\(/, `${label} must render the editable name`);
}

// Renaming persists and marks the name as deliberate.
const handler = view.slice(view.indexOf('handleRenameInstanceEvent(e: Event) {'));
const body = handler.slice(0, handler.indexOf('\n    }\n'));
assert.match(body, /hasCustomName = true/, 'rename must protect the name from renumbering');
assert.match(body, /hasCustomName = false/, 'clearing the field must restore the automatic name');
assert.match(body, /autoSaveCurrentEncounter/, 'rename must persist');

// New instances must not inherit a custom name from the instance used as their
// template, or "Add to Group" produces a nameless copy.
const factory = view.slice(view.indexOf('createNewInstanceFromTemplate(template: StatblockData'));
assert.match(
    factory.slice(0, factory.indexOf('\n    }')),
    /hasCustomName: false/,
    'a new instance must start with the automatic name',
);

// Escape reverts, Enter commits.
assert.match(nameRenderer, /'Escape'/);
assert.match(nameRenderer, /'Enter'/);
assert.match(nameRenderer, /settle\(false\)/, 'Escape must discard the edit');

// Listener is registered and torn down.
assert.match(view, /addEventListener\(EVENT_RENAME_INSTANCE/);
assert.match(view, /removeEventListener\(EVENT_RENAME_INSTANCE/);

console.log('Instance rename regression passed');
