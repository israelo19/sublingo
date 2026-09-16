import type { ContentScriptContext } from '#imports';

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName);
};

/** Window-level capture-phase hotkeys so YouTube's own handlers never see them. */
export function installHotkeys(ctx: ContentScriptContext, keys: () => HotkeyMap): void {
  ctx.addEventListener(
    window,
    'keydown',
    (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) return;
      const fn = keys()[e.key.toLowerCase()];
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      fn(e);
    },
    { capture: true },
  );
}
