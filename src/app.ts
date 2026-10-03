import './style.css';
import { mountLabShell } from './labs/shell';

const dispose = mountLabShell(document.querySelector<HTMLElement>('#app')!);
window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); });
