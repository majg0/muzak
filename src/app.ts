import './style.css';
import { mountScoreWorkbench } from './score/workbench';

const score = document.querySelector<HTMLElement>('#app')!;
score.id = 'score-workspace';
const navigation = document.createElement('nav');
navigation.className = 'workspace-navigation';
navigation.setAttribute('aria-label', 'Music workspace');
navigation.innerHTML = '<a href="./" class="workspace-wordmark">continuum.</a><span>Compose · inspect · transform</span>';
document.body.prepend(navigation);
try { await mountScoreWorkbench(score); }
catch (error) { score.textContent = `Could not open the workshop: ${(error as Error).message}. Reload to retry.`; }
