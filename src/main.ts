import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import { Game } from './game/game';
import { heightAt } from './world/terrain';

// Let the loading screen paint before the (synchronous) world build starts.
requestAnimationFrame(() =>
  setTimeout(() => {
    const game = new Game(document.getElementById('game') as HTMLCanvasElement);
    if (import.meta.env.DEV) Object.assign(window, { game, heightAt });
  }, 30),
);
