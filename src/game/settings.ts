// Player settings that are remembered between visits (currently just the graphics quality).
import { isTouch } from './input';

export type Quality = 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** upper limit on the canvas resolution, as a multiple of CSS pixels */
  pixelRatio: number;
  /** sun shadow map size in texels; 0 turns shadows off */
  shadowMap: number;
  /** dinosaurs closer than this cast shadows */
  npcShadow: number;
  /** dinosaurs further away than this are not drawn or animated */
  npcRange: number;
  /** share of the grass, flowers, ferns, bushes and pebbles that is drawn */
  density: number;
}

/** High is the game as originally tuned; Medium and Low trade detail for speed on slower tablets. */
export const QUALITY: Record<Quality, QualityPreset> = {
  high: { pixelRatio: isTouch ? 1.5 : 2, shadowMap: isTouch ? 1024 : 2048, npcShadow: 55, npcRange: 135, density: 1 },
  medium: { pixelRatio: isTouch ? 1 : 1.5, shadowMap: isTouch ? 512 : 1024, npcShadow: 32, npcRange: 135, density: 0.5 },
  low: { pixelRatio: isTouch ? 0.75 : 1, shadowMap: 0, npcShadow: 0, npcRange: 100, density: 0.2 },
};

const KEY = 'dino-world.graphics';

export function loadQuality(): Quality {
  try {
    const q = localStorage.getItem(KEY);
    if (q === 'low' || q === 'medium' || q === 'high') return q;
  } catch {
    // storage can be blocked (private windows); fall through to the default
  }
  return 'high';
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // not remembered this time; the setting still applies until the page is closed
  }
}
