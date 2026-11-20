import { RefObject, useEffect, useState } from 'react';

export interface LazyImageInViewOptions {
  /** Skip IntersectionObserver and load immediately (e.g. hero / above-the-fold priority) */
  eager?: boolean;
  /** Disable observation (e.g. Admin preview locked to loading/error state) */
  enabled?: boolean;
  /** Lookahead distance for vertical scroll containers/viewport (px) */
  verticalMarginPx?: number;
  /** Lookahead distance for horizontal carousels (px) */
  horizontalMarginPx?: number;
}

export interface DetectedScrollRoots {
  horizontalRoot: HTMLElement | null;
  verticalRoot: HTMLElement | null;
}

const SCROLL_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'overlay']);

/**
 * Walks ancestors from the image wrapper to identify both an inner horizontal
 * carousel scroll container and an enclosing vertical scroll container (modal/drawer),
 * if any exist.
 */
export function findScrollableRoots(element: HTMLElement | null): DetectedScrollRoots {
  if (!element || typeof window === 'undefined') {
    return { horizontalRoot: null, verticalRoot: null };
  }

  let horizontalRoot: HTMLElement | null = null;
  let verticalRoot: HTMLElement | null = null;
  let current: HTMLElement | null = element.parentElement;

  while (
    current &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    const style = window.getComputedStyle(current);
    const hasScrollXOverflow = SCROLL_OVERFLOW_VALUES.has(style.overflowX);
    const hasScrollYOverflow = SCROLL_OVERFLOW_VALUES.has(style.overflowY);

    const canScrollHorizontally =
      hasScrollXOverflow &&
      (current.scrollWidth > current.clientWidth + 2 ||
        current.scrollHeight <= current.clientHeight + 4);

    const canScrollVertically =
      hasScrollYOverflow && current.scrollHeight > current.clientHeight + 4;

    if (!horizontalRoot && canScrollHorizontally && !canScrollVertically) {
      horizontalRoot = current;
    } else if (!verticalRoot && canScrollVertically) {
      verticalRoot = current;
      // Stop once we have the nearest vertical container (e.g. drawer/modal);
      // anything outside it is outside the modal scroll viewport.
      break;
    }

    current = current.parentElement;
  }

  return { horizontalRoot, verticalRoot };
}

function getRootBoundsRect(root: HTMLElement | null): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (root) {
    const r = root.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  }
  const vw = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight || 720 : 720;
  return { top: 0, bottom: vh, left: 0, right: vw };
}

function isElementVisiblyRendered(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return false;
  if (typeof window !== 'undefined') {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function checkVerticalProximity(
  rect: DOMRect,
  verticalRoot: HTMLElement | null,
  verticalMarginPx: number
): boolean {
  const bounds = getRootBoundsRect(verticalRoot);
  return rect.bottom >= bounds.top - verticalMarginPx && rect.top <= bounds.bottom + verticalMarginPx;
}

function checkHorizontalProximity(
  rect: DOMRect,
  horizontalRoot: HTMLElement | null,
  horizontalMarginPx: number
): boolean {
  const bounds = getRootBoundsRect(horizontalRoot);
  return (
    rect.right >= bounds.left - horizontalMarginPx &&
    rect.left <= bounds.right + horizontalMarginPx
  );
}

/**
 * Reliable IntersectionObserver hook for lazy image loading across:
 * - Main vertical page scroll
 * - RTL/LTR horizontal carousels (overflow-x-auto)
 * - Internal modal / drawer vertical scrollers (overflow-y-auto)
 *
 * Once triggered, all observers disconnect cleanly so no duplicate triggers occur.
 */
export function useLazyImageInView(
  targetRef: RefObject<HTMLElement | null>,
  options: LazyImageInViewOptions = {}
): boolean {
  const {
    eager = false,
    enabled = true,
    verticalMarginPx = 320,
    horizontalMarginPx = 340,
  } = options;

  const [inView, setInView] = useState<boolean>(() => {
    if (!enabled) return false;
    if (eager) return true;
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (!enabled) {
      setInView(false);
      return;
    }

    if (eager) {
      setInView(true);
      return;
    }

    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    if (inView) {
      return;
    }

    const el = targetRef.current;
    if (!el) return;

    let cancelled = false;
    const { horizontalRoot, verticalRoot } = findScrollableRoots(el);

    const activate = () => {
      if (cancelled) return;
      setInView(true);
      hObserver?.disconnect();
      vObserver?.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const syncGeometryCheck = (): boolean => {
      if (!isElementVisiblyRendered(el)) return false;
      const rect = el.getBoundingClientRect();
      const vOk = checkVerticalProximity(rect, verticalRoot, verticalMarginPx);
      if (!vOk) return false;
      const hOk = horizontalRoot
        ? checkHorizontalProximity(rect, horizontalRoot, horizontalMarginPx)
        : checkHorizontalProximity(rect, verticalRoot, horizontalMarginPx);
      if (vOk && hOk) {
        activate();
        return true;
      }
      return false;
    };

    let hObserver: IntersectionObserver | null = null;
    let vObserver: IntersectionObserver | null = null;
    let rafId: number | null = null;

    if (syncGeometryCheck()) {
      return;
    }

    if (horizontalRoot) {
      // Carousel item: require BOTH vertical proximity of the row AND horizontal proximity inside the carousel
      const initialRect = el.getBoundingClientRect();
      let horizontalHit = isElementVisiblyRendered(el)
        ? checkHorizontalProximity(initialRect, horizontalRoot, horizontalMarginPx)
        : false;
      let verticalHit = isElementVisiblyRendered(el)
        ? checkVerticalProximity(initialRect, verticalRoot, verticalMarginPx)
        : false;

      const tryActivateBoth = () => {
        if (horizontalHit && verticalHit) {
          activate();
        }
      };

      hObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          horizontalHit = entry.isIntersecting;
          if (horizontalHit) {
            // Re-verify vertical proximity synchronously on horizontal scroll in case layout shifted
            const r = el.getBoundingClientRect();
            if (isElementVisiblyRendered(el) && checkVerticalProximity(r, verticalRoot, verticalMarginPx)) {
              verticalHit = true;
            }
          }
          tryActivateBoth();
        },
        {
          root: horizontalRoot,
          rootMargin: `120px ${horizontalMarginPx}px`,
          threshold: 0.01,
        }
      );

      vObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          verticalHit = entry.isIntersecting;
          if (verticalHit) {
            const r = el.getBoundingClientRect();
            if (
              isElementVisiblyRendered(el) &&
              checkHorizontalProximity(r, horizontalRoot, horizontalMarginPx)
            ) {
              horizontalHit = true;
            }
          }
          tryActivateBoth();
        },
        {
          root: verticalRoot,
          // Large horizontal margin so carousel row vertical visibility triggers reliably even for offscreen-X slides
          rootMargin: `${verticalMarginPx}px 20000px`,
          threshold: 0.01,
        }
      );

      hObserver.observe(el);
      vObserver.observe(horizontalRoot);
    } else {
      vObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            activate();
          }
        },
        {
          root: verticalRoot,
          rootMargin: `${verticalMarginPx}px ${horizontalMarginPx}px`,
          threshold: 0.01,
        }
      );
      vObserver.observe(el);
    }

    // Re-check once after initial layout frame settles (helps when async catalog swaps or transforms settle)
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!cancelled) {
        syncGeometryCheck();
      }
    });

    return () => {
      cancelled = true;
      hObserver?.disconnect();
      vObserver?.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [eager, enabled, inView, targetRef, verticalMarginPx, horizontalMarginPx]);

  return eager ? enabled : inView;
}
