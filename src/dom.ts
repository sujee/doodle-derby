type Child = Node | string;

/** Tiny element builder. Strings become text nodes, so model output is never parsed as HTML. */
export function el(tag: string, attrs: Record<string, string> = {}, children: Child | Child[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...(Array.isArray(children) ? children : [children]));
  return node;
}
