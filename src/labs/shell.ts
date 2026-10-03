import './shell.css';
import { labs, labRoute, matchesLab } from './catalog';
import { createLabHost } from './host';

export function mountLabShell(container: HTMLElement): () => void {
  const abort = new AbortController();
  container.classList.add('lab-shell');
  container.innerHTML = `<header class="lab-topbar"><a class="lab-wordmark" href="#/labs">continuum<span>.</span></a><span class="lab-topbar-label">Music laboratory</span><span class="lab-topbar-note">Ideas worth listening to.</span></header>
    <div class="lab-layout"><aside class="lab-sidebar"><label class="lab-search-label">Find a lab<input type="search" data-shell="search" placeholder="Search experiments" autocomplete="off"/></label><nav data-shell="navigation" aria-label="Experiments"></nav><p class="lab-sidebar-note">One idea at a time.<br/>Your place to experiment.</p></aside>
    <main class="lab-main"><header class="lab-page-heading"><p class="eyebrow" data-shell="eyebrow">THE LABORATORY</p><h1 data-shell="title" tabindex="-1">Music lab</h1><p data-shell="description">Start with a melody, a rhythm, or a complete passage.</p></header>
      <section data-shell="library" aria-label="Available labs"><div class="lab-library-heading"><h2>Choose an experiment</h2><output data-shell="count" aria-live="polite"></output></div><div class="lab-cards" data-shell="cards"></div><p class="lab-empty" data-shell="empty" hidden>No labs match your search. Try a musical idea such as pitch, pulses or MIDI.</p></section>
      <div class="lab-load-status panel" data-shell="status" role="status" aria-live="polite" hidden><p data-shell="status-text"></p><button class="button" data-shell="retry" hidden>Try again</button></div><div data-shell="content"></div>
    </main></div>`;
  const get = <T extends HTMLElement>(name: string) => container.querySelector<T>(`[data-shell="${name}"]`)!;
  let selected: string | undefined, hasRouted = false;
  const host = createLabHost({
    definitions: labs,
    createContainer() { const element = document.createElement('section'); element.className = 'lab-mount'; return element; },
    show(element) { get('content').replaceChildren(...element ? [element] : []); },
    changed(status) {
      get('status').hidden = status.phase === 'idle' || status.phase === 'ready';
      get('retry').hidden = status.phase !== 'error';
      get('content').setAttribute('aria-busy', String(status.phase === 'loading'));
      get('status-text').textContent = status.phase === 'error' ? `Could not open this lab: ${status.message}` : status.phase === 'loading' ? 'Opening the lab…' : '';
    },
  });
  function renderCatalog(): void {
    const query = get<HTMLInputElement>('search').value;
    const visible = labs.filter(lab => matchesLab(lab, query));
    const navigation = document.createDocumentFragment(), all = document.createElement('a');
    all.href = '#/labs'; all.className = 'lab-nav-all'; all.textContent = 'All labs';
    if (!selected) all.setAttribute('aria-current', 'page');
    navigation.append(all);
    for (const group of new Set(visible.map(lab => lab.group))) {
      const section = document.createElement('div'); section.className = 'lab-nav-group';
      const heading = document.createElement('h2'); heading.textContent = group; section.append(heading);
      for (const lab of visible.filter(lab => lab.group === group)) {
        const link = document.createElement('a'); link.href = `#/labs/${lab.id}`; link.textContent = lab.title;
        if (lab.id === selected) link.setAttribute('aria-current', 'page');
        section.append(link);
      }
      navigation.append(section);
    }
    get('navigation').replaceChildren(navigation);
    const cards = document.createDocumentFragment();
    for (const lab of visible) {
      const link = document.createElement('a'); link.href = `#/labs/${lab.id}`; link.className = 'lab-card'; link.dataset.lab = lab.id;
      const group = document.createElement('span'); group.className = 'lab-card-group'; group.textContent = lab.group;
      const title = document.createElement('h3'); title.textContent = lab.title;
      const description = document.createElement('p'); description.textContent = lab.description;
      const tags = document.createElement('div'); tags.className = 'lab-card-tags';
      for (const label of lab.tags) { const tag = document.createElement('span'); tag.textContent = label; tags.append(tag); }
      const open = document.createElement('span'); open.className = 'lab-card-open'; open.textContent = 'Open lab →';
      link.append(group, title, description, tags, open); cards.append(link);
    }
    get('cards').replaceChildren(cards); get('empty').hidden = visible.length > 0;
    get('count').textContent = `${visible.length} ${visible.length === 1 ? 'lab' : 'labs'}`;
  }
  function route(): void {
    const next = labRoute(window.location.hash);
    const lab = next.kind === 'lab' ? labs.find(lab => lab.id === next.id) : undefined;
    selected = lab?.id;
    get('library').hidden = next.kind !== 'library';
    get('eyebrow').textContent = lab ? `${lab.group.toUpperCase()} / LAB` : 'THE LABORATORY';
    get('title').textContent = lab?.title ?? (next.kind === 'library' ? 'Music lab' : 'Lab not found');
    get('description').textContent = lab?.description ?? (next.kind === 'library' ? 'Start with a melody, a rhythm, or a complete passage.' : 'Choose an experiment from the sidebar or return to All labs.');
    document.title = `${lab?.title ?? 'Music lab'} · Continuum`;
    renderCatalog();
    if (lab) void host.open(lab.id);
    else host.close();
    if (hasRouted) get('title').focus({preventScroll: true});
    hasRouted = true;
  }
  get('search').addEventListener('input', renderCatalog, {signal: abort.signal});
  get('retry').addEventListener('click', () => { if (selected) void host.open(selected); }, {signal: abort.signal});
  window.addEventListener('hashchange', route, {signal: abort.signal});
  route();
  return () => { abort.abort(); host.dispose(); container.replaceChildren(); container.classList.remove('lab-shell'); };
}
