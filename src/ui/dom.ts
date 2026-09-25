/** Tiny DOM helpers (decision D2: plain TypeScript + DOM, no framework). */

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  append(node, children);
  return node;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

/** Element with a single text child. */
export function txt<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  children: readonly (SVGElement | null)[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

/** A focusable button that never submits and never keeps mouse focus rings from the browser. */
export function button(className: string, children: readonly Child[]): HTMLButtonElement {
  const b = el('button', className, children);
  b.type = 'button';
  b.tabIndex = -1;
  return b;
}

/** Sets the stagger index used by the enter animation (items enter 30 ms apart). */
export function stagger<T extends HTMLElement>(node: T, index: number): T {
  node.classList.add('s1-in');
  node.style.setProperty('--i', String(Math.min(index, 14)));
  return node;
}

/** Marks an element disabled with a reason shown as a tooltip (ZD-J04). */
export function setDisabled(node: HTMLElement, reason: string | null): void {
  if (reason) {
    node.setAttribute('aria-disabled', 'true');
    node.dataset.tip = reason;
    node.classList.add('is-disabled');
  } else {
    node.removeAttribute('aria-disabled');
    delete node.dataset.tip;
    node.classList.remove('is-disabled');
  }
}

/** Small inline chevron icon (the Latin subsets of the fonts have no left/right arrows). */
export function chevron(direction: 'left' | 'right' | 'up' | 'down', className = 's1-chev'): SVGSVGElement {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[direction];
  return svg('svg', { class: className, viewBox: '0 0 8 8', 'aria-hidden': 'true' }, [
    svg('path', {
      d: 'M2.5 1 L5.5 4 L2.5 7',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.25,
      transform: `rotate(${rot} 4 4)`,
    }),
  ]);
}
