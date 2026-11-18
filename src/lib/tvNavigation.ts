// Spatial D-pad / Remote Control & Keyboard Navigation Engine for Smart TV,
// Android TV, Google TV, and Desktop accessibility.

export type SpatialDirection = 'up' | 'down' | 'left' | 'right';

export interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]:not([aria-disabled="true"])',
].join(',');

export function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

export function isElementVisibleForFocus(el: HTMLElement): boolean {
  if (!el || el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
  }
  return true;
}

/**
 * Pure geometric scoring helper for spatial D-pad navigation.
 * Exported separately so it can be unit tested deterministically without a full DOM.
 */
export function selectBestSpatialCandidateIndex(
  current: RectBox,
  candidates: RectBox[],
  direction: SpatialDirection
): number {
  const cx = current.left + current.width / 2;
  const cy = current.top + current.height / 2;

  let bestIndex = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const tx = cand.left + cand.width / 2;
    const ty = cand.top + cand.height / 2;
    const dx = tx - cx;
    const dy = ty - cy;

    let isInDirection = false;
    let primaryDist = 0;
    let secondaryDist = 0;
    let hasAxisOverlap = false;

    if (direction === 'right') {
      isInDirection = dx > 4;
      primaryDist = dx;
      secondaryDist = Math.abs(dy);
      hasAxisOverlap = cand.bottom > current.top && cand.top < current.bottom;
    } else if (direction === 'left') {
      isInDirection = dx < -4;
      primaryDist = -dx;
      secondaryDist = Math.abs(dy);
      hasAxisOverlap = cand.bottom > current.top && cand.top < current.bottom;
    } else if (direction === 'down') {
      isInDirection = dy > 4;
      primaryDist = dy;
      secondaryDist = Math.abs(dx);
      hasAxisOverlap = cand.right > current.left && cand.left < current.right;
    } else if (direction === 'up') {
      isInDirection = dy < -4;
      primaryDist = -dy;
      secondaryDist = Math.abs(dx);
      hasAxisOverlap = cand.right > current.left && cand.left < current.right;
    }

    if (!isInDirection) continue;

    // Strongly favor aligned items on the same row/column
    const alignmentPenalty = hasAxisOverlap ? secondaryDist * 0.45 : secondaryDist * 2.4 + 120;
    const score = primaryDist + alignmentPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function getActiveFocusRoot(): HTMLElement {
  if (typeof document === 'undefined') return null as unknown as HTMLElement;
  const modals = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [data-rtv-focus-trap="true"]')
  ).filter(isElementVisibleForFocus);

  if (modals.length > 0) {
    return modals[modals.length - 1];
  }
  return document.body;
}

export function findNextSpatialTarget(
  current: HTMLElement | null,
  direction: SpatialDirection
): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const root = getActiveFocusRoot();
  if (!root) return null;

  const allCandidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el !== current && isElementVisibleForFocus(el)
  );
  if (allCandidates.length === 0) return null;

  if (!current || !root.contains(current)) {
    return allCandidates[0];
  }

  const currentRect = current.getBoundingClientRect();
  const candidateRects = allCandidates.map((el) => el.getBoundingClientRect());
  const idx = selectBestSpatialCandidateIndex(currentRect, candidateRects, direction);
  return idx >= 0 ? allCandidates[idx] : null;
}

export interface TvNavigationOptions {
  onBack?: () => boolean | void;
}

/**
 * Installs global D-pad / keyboard spatial navigation listener and returns cleanup.
 * Does not hijack arrow keys inside text inputs or video `<video>` containers that handle seeking.
 */
export function installTvSpatialNavigation(options: TvNavigationOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  let focusHistory: HTMLElement[] = [];

  const markKeyboardNav = () => {
    document.documentElement.classList.add('rtv-keyboard-nav');
  };

  const clearKeyboardNav = () => {
    document.documentElement.classList.remove('rtv-keyboard-nav');
  };

  const handleFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && target !== document.body) {
      focusHistory = [target, ...focusHistory.filter((el) => el !== target)].slice(0, 12);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const key = e.key;
    const active = document.activeElement as HTMLElement | null;

    // Skip when typing inside an editable field
    if (isEditableElement(active)) {
      if (key === 'Escape') {
        active?.blur();
      }
      return;
    }

    // Back / Escape / Android TV Back button
    if (key === 'Escape' || key === 'BrowserBack' || key === 'GoBack') {
      const handled = options.onBack?.();
      if (handled) {
        e.preventDefault();
        // Restore previous valid focus
        const nextValid = focusHistory.find((el) => document.body.contains(el) && isElementVisibleForFocus(el));
        nextValid?.focus();
      }
      return;
    }

    // Backspace outside inputs triggers back navigation on TV browsers
    if (key === 'Backspace') {
      const handled = options.onBack?.();
      if (handled) {
        e.preventDefault();
      }
      return;
    }

    // Let video player container manage Left/Right seek arrows when focused inside player
    if (active?.closest('[data-rtv-player-controls="true"]')) {
      return;
    }

    let direction: SpatialDirection | null = null;
    if (key === 'ArrowUp') direction = 'up';
    else if (key === 'ArrowDown') direction = 'down';
    else if (key === 'ArrowLeft') direction = 'left';
    else if (key === 'ArrowRight') direction = 'right';

    if (!direction) return;

    // Only activate spatial movement when user is in TV mode or explicitly navigating via D-pad outside sliders
    const isTvMode = document.documentElement.getAttribute('data-rtv-tv-mode') === 'true';
    const isRangeInput = active?.tagName.toLowerCase() === 'input' && (active as HTMLInputElement).type === 'range';
    if (isRangeInput) return;

    // Allow regular horizontal scrolling inside overflow containers unless TV mode is enabled or nothing scrolls
    if (!isTvMode && !document.documentElement.classList.contains('rtv-keyboard-nav')) {
      markKeyboardNav();
    }

    const next = findNextSpatialTarget(active, direction);
    if (next) {
      e.preventDefault();
      markKeyboardNav();
      next.focus({ preventScroll: false });
      try {
        next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      } catch {
        next.scrollIntoView();
      }
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('pointerdown', clearKeyboardNav);
  document.addEventListener('focusin', handleFocusIn);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('pointerdown', clearKeyboardNav);
    document.removeEventListener('focusin', handleFocusIn);
  };
}
