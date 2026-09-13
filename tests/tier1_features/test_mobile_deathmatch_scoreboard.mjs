import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Smartphone deathmatch scoreboard is touch-accessible without changing desktop TAB behavior', () => {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'deathmatchScore.ts'), 'utf8');

    assert(source.includes("classList.contains('gone-smartphone')"), 'scoreboard must use the canonical smartphone presentation state');
    assert(source.includes("compactRoot!.addEventListener('pointerdown', toggleMobileBoard)"), 'smartphone score chip must accept direct pointer input');
    assert(source.includes('event.preventDefault();') && source.includes('event.stopPropagation();'), 'scoreboard touch must not leak into gameplay controls');
    assert(source.includes('boardVisible = !boardVisible;'), 'score chip must toggle the full scoreboard instead of only opening it');
    assert(source.includes('TOCCA CLASSIFICA') && source.includes('TOCCA PER CHIUDERE'), 'mobile copy must explain the touch interaction');
    assert(source.includes("compactRoot!.style.minHeight = smartphone ? '86px'"), 'scaled smartphone score chip must retain a practical touch target');
    assert(source.includes("boardRoot!.style.minWidth = smartphone ? '0'"), 'full scoreboard must be allowed to fit narrow smartphone viewports');
    assert(source.includes("boardRoot!.style.maxHeight = smartphone ? '62dvh'"), 'full scoreboard must stay bounded in landscape phone height');
    assert(source.includes("compactRoot!.setAttribute('aria-expanded', String(boardVisible))"), 'interactive score chip must expose expanded state');
    assert(source.includes("event.code !== 'Tab'") && source.includes('TAB CLASSIFICA'), 'desktop hold-TAB scoreboard contract must remain intact');
  });
}
