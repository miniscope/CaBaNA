import { createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';

/**
 * A box anchored to `anchor`, placed below it or above it, whichever has room, and kept inside the
 * window. Long content scrolls inside the box. Escape or a click outside closes it.
 */
export function Popover(props: {
  anchor: HTMLElement;
  onClose: () => void;
  width?: number;
  id?: string;
  role?: 'dialog' | 'tooltip';
  label?: string;
  class?: string;
  children: JSX.Element;
}): JSX.Element {
  let box!: HTMLDivElement;
  const [pos, setPos] = createSignal({ left: -9999, top: 0, maxH: 400, w: 300 });
  const place = () => {
    const a = props.anchor.getBoundingClientRect();
    const w = Math.min(props.width ?? 300, innerWidth - 16);
    const h = box.scrollHeight;
    const below = innerHeight - a.bottom - 14;
    const above = a.top - 14;
    const down = below >= Math.min(h, 260) || below >= above;
    const maxH = Math.max(120, down ? below : above);
    setPos({
      w,
      maxH,
      left: Math.min(Math.max(8, a.left + a.width / 2 - w / 2), innerWidth - w - 8),
      top: down ? a.bottom + 6 : Math.max(8, a.top - 6 - Math.min(h, maxH)),
    });
  };
  const outside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!box.contains(t) && !props.anchor.contains(t)) props.onClose();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    props.onClose();
    props.anchor.focus();
  };
  onMount(() => {
    place();
    requestAnimationFrame(place);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
  });
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', key, true);
    removeEventListener('resize', place);
    removeEventListener('scroll', place, true);
  });
  return (
    <Portal>
      <div
        ref={box}
        id={props.id}
        role={props.role ?? 'dialog'}
        aria-label={props.label}
        class={`cb-pop ${props.class ?? ''}`}
        style={{
          left: `${pos().left}px`,
          top: `${pos().top}px`,
          width: `${pos().w}px`,
          'max-height': `${pos().maxH}px`,
        }}
      >
        {props.children}
      </div>
    </Portal>
  );
}
