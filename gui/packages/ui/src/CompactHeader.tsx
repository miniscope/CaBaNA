import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

export interface CompactHeaderProps {
  title: string;
  version?: string;
  info?: JSX.Element;
  actions?: JSX.Element;
  /** Makes the logo block a button (title "Home"). */
  onBrandClick?: () => void;
  'data-tutorial'?: string;
}

export function CompactHeader(props: CompactHeaderProps): JSX.Element {
  return (
    <header class="compact-header" data-tutorial={props['data-tutorial']}>
      <div
        class="compact-header__brand"
        classList={{ 'compact-header__brand--button': !!props.onBrandClick }}
        // A div, not a button: the title inside is a heading.
        role={props.onBrandClick ? 'button' : undefined}
        tabindex={props.onBrandClick ? 0 : undefined}
        title={props.onBrandClick ? 'Home' : undefined}
        onClick={() => props.onBrandClick?.()}
        onKeyDown={(e) => {
          if (props.onBrandClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            props.onBrandClick();
          }
        }}
      >
        <h1 class="compact-header__title">{props.title}</h1>
        <Show when={props.version}>
          <span class="compact-header__version">{props.version}</span>
        </Show>
      </div>
      <Show when={props.info}>
        <div class="compact-header__info">{props.info}</div>
      </Show>
      <Show when={props.actions}>
        <div class="compact-header__actions">{props.actions}</div>
      </Show>
    </header>
  );
}
