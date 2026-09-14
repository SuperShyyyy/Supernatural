/**
 * 编辑区缩放模型。
 *
 * 只做一件事：把缩放级别写进 `--editor-zoom`（一个无单位数字），
 * 由 `.editor-content` 的 font-size 消费。
 *
 * 为什么不用 CSS `zoom` / `transform: scale()`：
 *  - `zoom` 会让 getBoundingClientRect() 返回缩放后的坐标，直接污染
 *    ProseMirror 的 posAtCoords / coordsAtPos、光标定位与 NodeView 命中测试；
 *  - `transform: scale()` 同样破坏坐标映射，且文字发虚、命中区域与视觉不重合；
 *  - 两者都会让 sticky / fixed 与滚动容器的行为变得不可预测。
 *
 * font-metric 缩放（改 font-size + 内部全用 em/ch/%）让布局数学始终停留在
 * CSS px 空间，坐标系唯一，编辑器内核无需任何补偿。
 */

export const ZOOM_LEVELS: readonly number[] = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];

const MIN_ZOOM = ZOOM_LEVELS[0] ?? 50;
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] ?? 300;
const STORAGE_KEY = 'md-editer.prototype.zoom';

export function clampZoom(level: number): number {
  if (!Number.isFinite(level)) return 100;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(level)));
}

export function loadZoom(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? 100 : clampZoom(Number(raw));
  } catch {
    // 隐私模式 / 禁用存储时不应影响编辑器可用性
    return 100;
  }
}

export function saveZoom(level: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(level));
  } catch {
    /* 忽略：持久化失败不影响本次会话 */
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

  /** 在预设档位之间移动；当前值不是预设档位时先归到最近的档位。 */
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
    ZOOM_LEVELS.forEach((level, i) => {
      const delta = Math.abs(level - this.#level);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    });
    return best;
  }

  #apply(): void {
    this.#target.style.setProperty('--editor-zoom', String(this.#level / 100));
  }
}
