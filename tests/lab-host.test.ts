import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabHost, type LabStatus } from '../src/labs/host';
import { createLabScope } from '../src/labs/scope';
import { labRoute, labs, matchesLab } from '../src/labs/catalog';
import type { LabDefinition, LabModule, LabSession } from '../src/labs/types';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function definition(id: string, load: () => Promise<LabModule>): LabDefinition {
  return {id, title: id, group: 'Test', description: '', tags: [], load};
}
function setup(definitions: LabDefinition[]) {
  const statuses: LabStatus[] = [], scopes: ReturnType<typeof createLabScope>[] = [];
  let shown: HTMLElement | undefined;
  const host = createLabHost({definitions,
    createContainer: () => ({} as HTMLElement), show: container => { shown = container; },
    changed: status => { statuses.push(status); },
    createScope: () => { const scope = createLabScope(); scopes.push(scope); return scope; },
  });
  return {host, statuses, scopes, shown: () => shown};
}
test('slow imports cannot mount into a subsequently selected lab', async () => {
  const slow = deferred<LabModule>(), mounted: string[] = [];
  const module = (id: string): LabModule => ({createSession: () => ({mount: () => { mounted.push(id); }})});
  const {host, scopes, statuses} = setup([definition('slow', () => slow.promise), definition('fast', async () => module('fast'))]);
  const opening = host.open('slow'); await host.open('fast');
  slow.resolve(module('slow')); await opening;
  assert.deepEqual(mounted, ['fast']); assert.equal(scopes[0].signal.aborted, true);
  assert.deepEqual(statuses.at(-1), {phase: 'ready', id: 'fast'}); host.dispose();
});
test('navigation releases a pending mount and ignores its later failure', async () => {
  const pending = deferred<void>(), started = deferred<void>(); let released = 0;
  const {host, statuses} = setup([
    definition('a', async () => ({createSession: () => ({async mount(_host, context) {
      context.onDispose(() => { released++; }); started.resolve(); await pending.promise;
    }})})),
    definition('b', async () => ({createSession: () => ({mount() {}})})),
  ]);
  const opening = host.open('a'); await started.promise; await host.open('b');
  assert.equal(released, 1); pending.reject(new Error('Old experiment failed')); await opening;
  assert.deepEqual(statuses.at(-1), {phase: 'ready', id: 'b'}); host.dispose();
});
test('sessions retain private data while every activation gets fresh resources', async () => {
  let created = 0; const visits: number[] = [], releases: number[] = [];
  const {host, scopes} = setup([definition('independent', async () => ({createSession() {
    created++; let draft = 0;
    return {mount(_host, context) { const visit = ++draft; visits.push(visit); context.onDispose(() => { releases.push(visit); }); }};
  }}))]);
  await host.open('independent'); host.close(); await host.open('independent');
  assert.equal(created, 1); assert.deepEqual(visits, [1, 2]); assert.deepEqual(releases, [1]);
  assert.notEqual(scopes[0], scopes[1]); assert.equal(scopes[0].signal.aborted, true);
  assert.equal(scopes[1].signal.aborted, false); host.dispose(); host.dispose();
  assert.deepEqual(releases, [1, 2]);
});
test('a failed mount releases partial resources and does not disable sibling labs', async () => {
  let released = 0;
  const {host, statuses, shown} = setup([
    definition('broken', async () => ({createSession: () => ({mount(_host, context) {
      context.onDispose(() => { released++; }); throw new Error('Missing instrument');
    }})})),
    definition('plain', async () => ({createSession: (): LabSession => ({mount() { /* No score, player or timeline required. */ }})})),
  ]);
  await host.open('broken'); assert.equal(released, 1); assert.equal(shown(), undefined);
  assert.deepEqual(statuses.at(-1), {phase: 'error', id: 'broken', message: 'Missing instrument'});
  await host.open('plain'); assert.ok(shown()); assert.deepEqual(statuses.at(-1), {phase: 'ready', id: 'plain'});
  host.dispose(); await assert.rejects(host.open('plain'), /disposed/);
});
test('scope cleanup is exhaustive, idempotent and immediate for late registrations', async () => {
  const scope = createLabScope(), released: string[] = [];
  scope.onDispose(() => { released.push('first'); });
  scope.onDispose(() => { released.push('second'); throw new Error('cleanup'); });
  assert.throws(() => scope.dispose(), /release every lab resource/);
  assert.equal(scope.signal.aborted, true); assert.deepEqual(released, ['second', 'first']);
  scope.dispose(); scope.onDispose(() => { released.push('late'); });
  assert.deepEqual(released, ['second', 'first', 'late']);
  await assert.rejects(scope.call('getLabDefaults', {}), /disposed/);
});
test('catalog discovery does not require mounted modules and routes are explicit', () => {
  assert.equal(labs.filter(lab => matchesLab(lab, 'PULSES rotation')).length, 1);
  assert.equal(labs.filter(lab => matchesLab(lab, 'missing experiment')).length, 0);
  assert.deepEqual(labRoute(''), {kind: 'library'});
  assert.deepEqual(labRoute('#/labs/rhythm'), {kind: 'lab', id: 'rhythm'});
  assert.deepEqual(labRoute('#/labs/rhythm/more'), {kind: 'missing'});
  const duplicate = definition('same', async () => ({createSession: () => ({mount() {}})}));
  assert.throws(() => setup([duplicate, duplicate]), /duplicate/);
});
