import './value-tree-editor.css';
import type { ValueTree } from '../core/generated/ValueTree';
import type { ValueTreeProgram } from '../core/generated/ValueTreeProgram';
import type { PatternOperation } from '../core/generated/PatternOperation';

type Segment = 'tree' | 'parent' | number;
export interface TreeAddress { definition?: string; path: Segment[] }
export interface ValueTreeEditorState<T> {
  program: ValueTreeProgram<T>;
  selected: TreeAddress;
  view: TreeAddress;
  pending: Record<string, string>;
}
interface EditorOptions<T> {
  label: string;
  description: string;
  domain: 'degree' | 'duration' | 'gate' | 'native';
  format: (value: T) => string;
  parse: (text: string) => T;
  defaultValue: () => T;
  operations: Array<{ value: PatternOperation; label: string }>;
  onChange: (program: ValueTreeProgram<T>) => void;
  signal: AbortSignal;
}

const kindNames: Record<ValueTree<unknown>['kind'], string> = {
  leaf: 'Value', sequence: 'Sequence', ref: 'Shared reference', repeat: 'Repeat',
  cycle: 'Cycle to length', combine: 'Combine', expand: 'Expand',
};
const explanations: Record<ValueTree<unknown>['kind'], string> = {
  leaf: 'One value. Its position belongs to this tree; its timing comes from the independent duration tree.',
  sequence: 'Read these branches in order. Each branch can contain another complete tree.',
  ref: 'Use a shared definition. Editing its contents changes every reference to it.',
  repeat: 'Repeat the entire source tree this many times.',
  cycle: 'Cycle the source until it supplies exactly this many values; cut the last cycle if needed.',
  combine: 'Combine corresponding values from several equally long branches.',
  expand: 'For each parent value, choose a child branch in rotation, then combine that parent with every value in the chosen child.',
};
const addressKey = (address: TreeAddress) => JSON.stringify(address);
const sameAddress = (a: TreeAddress, b: TreeAddress) => addressKey(a) === addressKey(b);
const pendingKey = (address: TreeAddress, field: string) => JSON.stringify({ address, field });
const childAddress = (address: TreeAddress, segment: Segment): TreeAddress => ({ ...address, path: [...address.path, segment] });

/** A structural editor for the generated Rust contract. Interpretation and
 * evaluation of values, pitch, and time remain entirely in the Rust compiler. */
export function mountValueTreeEditor<T>(host: HTMLElement, options: EditorOptions<T>) {
  let program: ValueTreeProgram<T> = { definitions: {}, tree: { kind: 'leaf', value: options.defaultValue() } };
  let selected: TreeAddress = { path: [] }, view: TreeAddress = { path: [] };
  let pending: Record<string, string> = {}, disposed = false;
  const history: ValueTreeEditorState<T>[] = [];
  const future: ValueTreeEditorState<T>[] = [];
  const collapsed = new Set<string>();
  let renderedNodes = 0;
  host.classList.add('value-tree-editor');
  host.dataset.treeDomain = options.domain;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (text: string, action: () => void, className = 'vte-action'): HTMLButtonElement => {
    const node = el('button', className, text); node.type = 'button';
    node.addEventListener('click', action); return node;
  };
  const leaf = (): ValueTree<T> => ({ kind: 'leaf', value: options.defaultValue() });
  const operation = () => options.operations[0]?.value ?? 'add';
  function at(address: TreeAddress): ValueTree<T> | undefined {
    let node: ValueTree<T> | undefined = address.definition === undefined ? program.tree : Object.hasOwn(program.definitions, address.definition) ? program.definitions[address.definition] : undefined;
    for (const part of address.path) {
      if (!node) return undefined;
      if (part === 'tree') node = node.kind === 'repeat' || node.kind === 'cycle' ? node.tree : undefined;
      else if (part === 'parent') node = node.kind === 'expand' ? node.parent : undefined;
      else node = node.kind === 'sequence' ? node.items[part] : node.kind === 'combine' ? node.operands[part] : node.kind === 'expand' ? node.children[part] : undefined;
    }
    return node;
  }
  function assign(address: TreeAddress, node: ValueTree<T>): void {
    if (address.path.length === 0) {
      if (address.definition === undefined) program.tree = node;
      else Object.defineProperty(program.definitions, address.definition, { value: node, enumerable: true, writable: true, configurable: true });
      return;
    }
    const parent = at({ ...address, path: address.path.slice(0, -1) });
    const key = address.path.at(-1)!;
    if (key === 'tree' && (parent?.kind === 'repeat' || parent?.kind === 'cycle')) parent.tree = node;
    else if (key === 'parent' && parent?.kind === 'expand') parent.parent = node;
    else if (typeof key === 'number') arrayChildren(parent)?.splice(key, 1, node);
  }
  function arrayChildren(node?: ValueTree<T>): ValueTree<T>[] | undefined {
    return node?.kind === 'sequence' ? node.items : node?.kind === 'combine' ? node.operands : node?.kind === 'expand' ? node.children : undefined;
  }
  function state(): ValueTreeEditorState<T> { return structuredClone({ program, selected, view, pending }); }
  function restore(value: ValueTreeEditorState<T>): void {
    ({ program, selected, view, pending } = structuredClone(value));
    if (!at(selected)) selected = { path: [] };
    if (!at(view)) view = { path: [] };
    render();
  }
  function change(action: () => void, redraw = true, checkPending = true): void {
    if (disposed) return;
    if (checkPending && !validate({ reveal: true })) return;
    history.push(state()); if (history.length > 40) history.shift(); future.length = 0;
    action(); if (redraw) render(); options.onChange(structuredClone(program));
  }
  function select(address: TreeAddress): void {
    selected = address; render();
    const input = host.querySelector<HTMLInputElement>('[data-tree-input]');
    if (input) { input.focus({ preventScroll: true }); input.select(); }
  }
  function open(address: TreeAddress): void { view = address; selected = address; render(); }
  function nodeText(node: ValueTree<T>): [string, string] {
    switch (node.kind) {
      case 'leaf': return [options.format(node.value), options.domain === 'degree' ? 'degree' : options.domain === 'duration' ? 'duration' : options.domain === 'gate' ? 'sound / rest' : 'millicents'];
      case 'ref': return [node.id || 'Choose a name', 'shared reference'];
      case 'sequence': return ['Sequence', `${node.items.length} branches · in order`];
      case 'repeat': return [`Repeat ×${node.count}`, 'whole source'];
      case 'cycle': return [`Cycle → ${node.count}`, 'exact value count'];
      case 'combine': return [operationName(node.operation), `${node.operands.length} branches · corresponding values`];
      case 'expand': return [`Expand · ${operationName(node.operation)}`, 'parent × child branches'];
    }
  }
  function operationName(value: PatternOperation): string { return options.operations.find(item => item.value === value)?.label ?? value; }
  function graph(node: ValueTree<T>, address: TreeAddress, references: Set<string>, depth: number): HTMLElement {
    const branch = el('li', `vte-branch vte-kind-${node.kind}`);
    const key = addressKey(address);
    if (++renderedNodes > 1200 || depth > 64) {
      branch.append(button('Open deeper branch', () => open(address), 'vte-node vte-compact'));
      return branch;
    }
    const [title, subtitle] = nodeText(node);
    const row = el('div', 'vte-node-row');
    const card = button('', () => select(address), 'vte-node');
    card.dataset.treeNode = node.kind; card.dataset.treeAddress = key;
    card.setAttribute('aria-label', `${options.label}: ${title}${address.definition === undefined ? '' : ` in shared ${address.definition}`}`);
    card.setAttribute('aria-pressed', String(sameAddress(address, selected)));
    card.title = subtitle;
    card.append(el('strong', 'vte-node-title', title));
    if (address.definition !== undefined && address.path.length === 0) card.append(el('span', 'vte-shared-badge', `Shared ${address.definition}`));
    row.append(card); branch.append(row);
    const children: Array<{ node: ValueTree<T>; address: TreeAddress; label?: string; references: Set<string> }> = [];
    if (node.kind === 'ref') {
      if (references.has(node.id)) branch.append(el('span', 'vte-tree-warning', 'Circular reference'));
      else if (!Object.hasOwn(program.definitions, node.id)) branch.append(el('span', 'vte-tree-warning', 'Missing definition'));
      else children.push({ node: program.definitions[node.id], address: { definition: node.id, path: [] }, references: new Set([...references, node.id]) });
    } else if (node.kind === 'repeat' || node.kind === 'cycle') children.push({ node: node.tree, address: childAddress(address, 'tree'), references });
    else {
      if (node.kind === 'expand') children.push({ node: node.parent, address: childAddress(address, 'parent'), label: 'Parent', references });
      arrayChildren(node)?.forEach((item, index) => children.push({ node: item, address: childAddress(address, index), label: node.kind === 'expand' ? `Child ${index + 1}` : undefined, references }));
    }
    if (children.length) {
      const toggle = button(collapsed.has(key) ? '+' : '−', () => { if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key); render(); }, 'vte-fold');
      toggle.setAttribute('aria-label', `${collapsed.has(key) ? 'Expand' : 'Collapse'} ${title}`);
      toggle.setAttribute('aria-expanded', String(!collapsed.has(key))); row.append(toggle);
      if (!collapsed.has(key)) {
        const list = el('ul', 'vte-children');
        for (const child of children) {
          const item = graph(child.node, child.address, child.references, depth + 1);
          if (child.label) item.prepend(el('span', 'vte-edge-label', child.label));
          list.append(item);
        }
        branch.append(list);
      }
    }
    return branch;
  }
  function pendingError(address: TreeAddress, field: string, text: string): string {
    const node = at(address);
    if (!node || (field === 'value' && node.kind !== 'leaf') || (field === 'count' && node.kind !== 'repeat' && node.kind !== 'cycle') || (field === 'id' && node.kind !== 'ref')) return '';
    try {
      if (field === 'value') options.parse(text);
      else if (field === 'count' && (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(Number(text)) || Number(text) < 1)) throw new Error('Use a positive whole number.');
      else if (field === 'id' && !text.trim()) throw new Error('Enter a shared definition name.');
      return '';
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  function inputField(container: HTMLElement, label: string, field: string, value: string, apply: (text: string) => void): void {
    const wrapper = el('label', 'vte-field'); wrapper.append(el('span', undefined, label));
    const input = el('input'); input.type = 'text'; input.spellcheck = false;
    input.setAttribute('aria-label', `${options.label} ${label.toLowerCase()}`); input.dataset.treeInput = field;
    const address = structuredClone(selected), key = pendingKey(address, field);
    input.value = pending[key] ?? value;
    const error = el('span', 'vte-field-error'); error.setAttribute('aria-live', 'polite');
    const check = () => { const message = pendingError(address, field, input.value); input.setCustomValidity(message); input.setAttribute('aria-invalid', String(!!message)); error.textContent = message; return !message; };
    check();
    input.addEventListener('input', () => {
      if (!check()) { pending[key] = input.value; return; }
      // Commit valid text without replacing the focused input. Enter-to-submit
      // observes the new value, and clicking another node needs only one click.
      // Invalid text remains a separate draft, never an executable value.
      delete pending[key];
      change(() => apply(input.value), false, false);
      const undo = host.querySelector<HTMLButtonElement>('[data-tree-history="undo"]');
      const redo = host.querySelector<HTMLButtonElement>('[data-tree-history="redo"]');
      if (undo) undo.disabled = history.length === 0;
      if (redo) redo.disabled = future.length === 0;
      const current = at(address)!;
      const [title, subtitle] = nodeText(current);
      for (const card of host.querySelectorAll<HTMLElement>('[data-tree-address]')) {
        if (card.dataset.treeAddress !== addressKey(address)) continue;
        card.querySelector('.vte-node-title')!.textContent = title;
        card.title = subtitle;
        card.setAttribute('aria-label', `${options.label}: ${title}${address.definition === undefined ? '' : ` in shared ${address.definition}`}`);
        const fold = card.parentElement?.querySelector<HTMLButtonElement>('.vte-fold');
        if (fold) fold.setAttribute('aria-label', `${fold.getAttribute('aria-expanded') === 'true' ? 'Collapse' : 'Expand'} ${title}`);
      }
      if (field === 'id') {
        const tree = host.querySelector('.vte-tree');
        renderedNodes = 0;
        tree?.replaceChildren(graph(at(view)!, view, new Set(view.definition === undefined ? [] : [view.definition]), 0));
        const edit = host.querySelector<HTMLButtonElement>('[data-tree-ref-edit]');
        if (edit && current.kind === 'ref') { edit.textContent = `Edit shared ${current.id || 'definition'}`; edit.disabled = !Object.hasOwn(program.definitions, current.id); }
      }
    });
    wrapper.append(input, error); container.append(wrapper);
  }
  function selectField(container: HTMLElement, label: string, value: string, values: Array<{ value: string; label: string }>, apply: (value: string) => void): void {
    const wrapper = el('label', 'vte-field'); wrapper.append(el('span', undefined, label));
    const select = el('select'); select.setAttribute('aria-label', `${options.label} ${label.toLowerCase()}`);
    for (const item of values) { const option = el('option', undefined, item.label); option.value = item.value; select.append(option); }
    select.value = value; select.addEventListener('change', () => change(() => apply(select.value))); wrapper.append(select); container.append(wrapper);
  }
  function replaceKind(kind: ValueTree<T>['kind']): void {
    const old = at(selected)!;
    const sources = old.kind === 'expand' ? [old.parent, ...old.children] : arrayChildren(old) ?? [old];
    let next: ValueTree<T>;
    switch (kind) {
      case 'leaf': next = leaf(); break;
      case 'ref': next = { kind: 'ref', id: Object.keys(program.definitions)[0] ?? '' }; break;
      case 'sequence': next = { kind, items: sources }; break;
      case 'combine': next = { kind, operation: operation(), operands: sources }; break;
      case 'expand': next = { kind, operation: operation(), parent: old, children: [leaf()] }; break;
      case 'repeat': case 'cycle': next = { kind, tree: old, count: 2 }; break;
    }
    assign(selected, next);
  }
  function wrap(kind: 'sequence' | 'repeat' | 'cycle' | 'combine' | 'expand'): void {
    const old = at(selected)!;
    let node: ValueTree<T>;
    if (kind === 'sequence') node = { kind, items: [old] };
    else if (kind === 'repeat' || kind === 'cycle') node = { kind, tree: old, count: 2 };
    else if (kind === 'combine') node = { kind, operation: operation(), operands: [old, leaf()] };
    else node = { kind, operation: operation(), parent: old, children: [leaf()] };
    assign(selected, node);
  }
  function sharedName(): string {
    let index = 1; while (Object.hasOwn(program.definitions, `Pattern ${index}`)) index++;
    return `Pattern ${index}`;
  }
  function inspector(): HTMLElement {
    const panel = el('div', 'vte-inspector'), node = at(selected)!;
    panel.dataset.treeInspector = options.domain;
    const heading = el('div', 'vte-inspector-heading');
    heading.append(el('strong', undefined, selected.definition === undefined ? kindNames[node.kind] : `${selected.definition} · ${kindNames[node.kind]}`));
    heading.title = `Level ${selected.path.length + 1}. ${explanations[node.kind]}`; panel.append(heading);
    const fields = el('div', 'vte-fields');
    if (node.kind === 'leaf') inputField(fields, 'Value', 'value', options.format(node.value), text => { const current = at(selected); if (current?.kind === 'leaf') current.value = options.parse(text); });
    if (node.kind === 'repeat' || node.kind === 'cycle') inputField(fields, node.kind === 'repeat' ? 'Repeat count' : 'Value count', 'count', String(node.count), text => { const current = at(selected); if (current?.kind === 'repeat' || current?.kind === 'cycle') current.count = Number(text); });
    if (node.kind === 'combine' || node.kind === 'expand') selectField(fields, 'Operation', node.operation, options.operations, value => { const current = at(selected); if (current?.kind === 'combine' || current?.kind === 'expand') current.operation = value as PatternOperation; });
    if (node.kind === 'ref') {
      inputField(fields, 'Reference name', 'id', node.id, text => { const current = at(selected); if (current?.kind === 'ref') current.id = text.trim(); });
      const edit = button(`Edit shared ${node.id || 'definition'}`, () => open({ definition: node.id, path: [] })); edit.dataset.treeRefEdit = ''; edit.disabled = !Object.hasOwn(program.definitions, node.id); fields.append(edit);
    }
    if (fields.childElementCount) panel.append(fields);
    const actions = el('div', 'vte-actions');
    const list = arrayChildren(node);
    if (list) actions.append(button(node.kind === 'expand' ? '+ Child branch' : '+ Branch', () => change(() => { list.push(leaf()); selected = childAddress(selected, list.length - 1); })));
    const parentAddress: TreeAddress = { ...selected, path: selected.path.slice(0, -1) };
    const key = selected.path.at(-1), siblings = selected.path.length ? arrayChildren(at(parentAddress)) : undefined;
    if (typeof key === 'number' && siblings) {
      actions.append(button('+ Sibling', () => change(() => { siblings.splice(key + 1, 0, leaf()); selected = childAddress(parentAddress, key + 1); })));
      const left = button('←', () => change(() => { [siblings[key - 1], siblings[key]] = [siblings[key], siblings[key - 1]]; selected = childAddress(parentAddress, key - 1); })); left.disabled = key === 0;
      left.title = 'Move earlier'; left.setAttribute('aria-label', `${options.label} move selected branch earlier`);
      const right = button('→', () => change(() => { [siblings[key + 1], siblings[key]] = [siblings[key], siblings[key + 1]]; selected = childAddress(parentAddress, key + 1); })); right.disabled = key === siblings.length - 1;
      right.title = 'Move later'; right.setAttribute('aria-label', `${options.label} move selected branch later`);
      const remove = button('Remove', () => change(() => { siblings.splice(key, 1); selected = parentAddress; }), 'vte-action vte-danger'); remove.disabled = siblings.length <= 1;
      actions.append(left, right, remove);
    }
    if (node.kind !== 'leaf' && node.kind !== 'ref') {
      const retained = node.kind === 'repeat' || node.kind === 'cycle' ? node.tree : node.kind === 'expand' ? node.parent : list?.[0];
      if (retained) actions.append(button('Unwrap', () => change(() => assign(selected, retained))));
    }
    const nest = button('Nest', () => change(() => wrap('sequence')));
    nest.title = 'Put this branch inside a new sequence'; actions.append(nest);
    panel.append(actions);
    const structure = el('details', 'vte-structure'); structure.append(el('summary', undefined, 'More'));
    structure.append(el('p', 'vte-explanation', node.kind === 'leaf' && options.domain === 'duration' ? 'One exact duration. Use a whole number or a fraction such as 2/3; sound and rest remain separate.' : explanations[node.kind]));
    const wraps = el('div', 'vte-actions');
    for (const kind of ['expand', 'repeat', 'cycle', 'combine'] as const) wraps.append(button(`Wrap in ${kindNames[kind].toLowerCase()}`, () => change(() => wrap(kind))));
    wraps.append(button('Make shared', () => change(() => {
      const name = sharedName(), source = at(selected)!;
      Object.defineProperty(program.definitions, name, { value: source, enumerable: true, writable: true, configurable: true });
      assign(selected, { kind: 'ref', id: name });
    })));
    structure.append(wraps);
    const kinds = el('div', 'vte-fields');
    selectField(kinds, 'Change type', node.kind, Object.entries(kindNames).map(([value, label]) => ({ value, label })), value => replaceKind(value as ValueTree<T>['kind']));
    kinds.append(el('p', 'vte-type-help', 'Wrapping keeps the selected branch. Changing to a value or reference replaces it; Undo restores it.'));
    structure.append(kinds); panel.append(structure);
    return panel;
  }
  function render(): void {
    if (disposed) return;
    const oldCanvas = host.querySelector('.vte-canvas');
    const scroll = { left: oldCanvas?.scrollLeft ?? 0, top: oldCanvas?.scrollTop ?? 0 };
    if (!at(selected)) selected = { path: [] };
    if (!at(view)) view = { path: [] };
    const header = el('div', 'vte-header');
    const title = el('div', 'vte-title'); title.append(el('h3', undefined, options.label));
    const help = el('details', 'vte-help');
    const helpSummary = el('summary', undefined, '?'); helpSummary.setAttribute('aria-label', `About ${options.label.toLowerCase()}`);
    help.append(helpSummary, el('p', undefined, `${options.description} Select a node to edit; Nest adds another level.`)); title.append(help); header.append(title);
    const undo = button('Undo', () => { const last = history.pop(); if (last) { future.push(state()); restore(last); options.onChange(structuredClone(program)); } }); undo.disabled = history.length === 0;
    const redo = button('Redo', () => { const next = future.pop(); if (next) { history.push(state()); restore(next); options.onChange(structuredClone(program)); } }); redo.disabled = future.length === 0;
    undo.dataset.treeHistory = 'undo'; redo.dataset.treeHistory = 'redo';
    const historyButtons = el('div', 'vte-history'); historyButtons.append(undo, redo); header.append(historyButtons);
    const nav = el('div', 'vte-navigation');
    const root = button('Whole tree', () => open({ path: [] }), 'vte-nav'); root.setAttribute('aria-pressed', String(view.definition === undefined && !view.path.length)); nav.append(root);
    for (const name of Object.keys(program.definitions)) {
      const item = button(`Shared ${name}`, () => open({ definition: name, path: [] }), 'vte-nav'); item.setAttribute('aria-pressed', String(view.definition === name)); nav.append(item);
    }
    nav.append(button('+ Shared pattern', () => change(() => { const name = sharedName(); Object.defineProperty(program.definitions, name, { value: { kind: 'sequence', items: [leaf()] }, enumerable: true, writable: true, configurable: true }); view = selected = { definition: name, path: [] }; }), 'vte-nav vte-new-definition'));
    const canvas = el('div', 'vte-canvas'); canvas.setAttribute('aria-label', `${options.label} visual tree`); canvas.tabIndex = 0;
    const tree = el('ul', 'vte-tree'); renderedNodes = 0;
    tree.append(graph(at(view)!, view, new Set(view.definition === undefined ? [] : [view.definition]), 0)); canvas.append(tree);
    host.replaceChildren(header, nav, canvas, inspector()); canvas.scrollLeft = scroll.left; canvas.scrollTop = scroll.top;
  }
  function validate({ reveal = false }: { reveal?: boolean } = {}): boolean {
    for (const [key, text] of Object.entries(pending)) {
      const { address, field } = JSON.parse(key) as { address: TreeAddress; field: string };
      if (pendingError(address, field, text)) {
        if (reveal) {
          selected = address; render();
          const input = host.querySelector<HTMLInputElement>(`[data-tree-input="${field}"]`);
          if (input?.getClientRects().length) { input.focus({ preventScroll: true }); input.reportValidity(); }
        }
        return false;
      }
    }
    return true;
  }
  function dispose(): void { disposed = true; host.replaceChildren(); options.signal.removeEventListener('abort', dispose); }
  options.signal.addEventListener('abort', dispose, { once: true });
  render();
  return {
    setProgram(value: ValueTreeProgram<T>): void { program = structuredClone(value); selected = { path: [] }; view = { path: [] }; pending = {}; history.length = future.length = 0; collapsed.clear(); render(); },
    getProgram(): ValueTreeProgram<T> { return structuredClone(program); },
    getState: state,
    setState(value: ValueTreeEditorState<T>): void { history.length = future.length = 0; restore(value); },
    validate,
    dispose,
  };
}
