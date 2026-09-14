/**
 * 编辑区缩放（Phase 0 Prototype 已验证的模型）。
 *
 * 只做一件事：把缩放级别写进 `--editor-zoom`（无单位数字），由
 * `.editor-content` 的 font-size 消费；列宽是 `min(理想 em 宽度, 100%)`，
 * 所以放大只会让每行字符数变少，永远不会撑破 viewport。
 *
 * 不使用 CSS `zoom` / `transform: scale()`：它们会让 getBoundingClientRect()
 * 返回缩放后的坐标，直接污染 ProseMirror 的 posAtCoords / coordsAtPos、
 * 光标定位与 NodeView 命中测试。
 */

export const ZOOM_LEVELS: readonly number[] = [
  50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300,
];

const MIN_ZOOM = ZOOM_LEVELS[0] ?? 50;
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] ?? 300;
const STORAGE_KEY = 'md-editer.zoom';

export function clampZoom(level: number): number {
  if (!Number.isFinite(level)) return 100;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(level)));
}

export function loadZoom(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? 100 : clampZoom(Number(raw));
  } catch {
    return 100;
  }
}

export function saveZoom(level: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(level));
  } catch {
    /* 持久化失败不影响本次会话 */
  }
}

export class ZoomController {
  readonly #target: HTMLElement;
  readonly #listeners = new Set<(level: number) => void>();
  #level: number;

  constructor(target: HTMLElement, initialLevel = 100) {
    this.#target = target;
    this.#level = clampZoom(initialLevel);
    this.#apply();
  }

  get level(): number {
    return this.#level;
  }

  set(level: number): void {
    const next = clampZoom(level);
    if (next === this.#level) return;
    this.#level = next;
    this.#apply();
    for (const listener of this.#listeners) listener(next);
  }

  step(direction: 1 | -1): void {
    const index = ZOOM_LEVELS.indexOf(this.#level);
    const base = index === -1 ? this.#nearestIndex() : index;
    const nextIndex = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, base + direction));
    this.set(ZOOM_LEVELS[nextIndex] ?? this.#level);
  }

  reset(): void {
    this.set(100);
  }

  onChange(listener: (level: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #nearestIndex(): number {
    let best = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    ZOOM_LEVELS.forEach((level, index) => {
      const delta = Math.abs(level - this.#level);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = index;
      }
    });
    return best;
  }

  #apply(): void {
    this.#target.style.setProperty('--editor-zoom', String(this.#level / 100));
  }
}
