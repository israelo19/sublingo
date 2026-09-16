import { baseLang } from '@/lib/subtitles/types';
import { tokenize } from '@/lib/subtitles/tokenize';
import { WordPopup } from './WordPopup';
import { primaryCue, secondaryText, state } from './store';

export interface OverlayActions {
  onWordClick(word: string, sentence: string, x: number, y: number): void;
  onClosePopup(): void;
  onSave(): void;
  onToggleSecondary(): void;
  onLookupLemma(lemma: string): void;
}

const stop = (e: Event) => e.stopPropagation();

export function App({ actions }: { actions: OverlayActions }) {
  const s = state.settings.value;
  const cue = primaryCue.value;
  const secondary = secondaryText.value;
  const status = state.status.value;
  const popup = state.popup.value;

  const onWord = (word: string, e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const root = el.closest('.sl-root') as HTMLElement | null;
    const r = el.getBoundingClientRect();
    const rr = root?.getBoundingClientRect() ?? { left: 0, top: 0 };
    actions.onWordClick(word, cue?.text ?? '', r.left - rr.left + r.width / 2, r.top - rr.top);
  };

  return (
    <div
      class="sl-root"
      style={{ '--sl-scale': String(s.fontSize / 100) } as Record<string, string>}
      onMouseDown={stop}
      onMouseUp={stop}
      onClick={stop}
      onDblClick={stop}
      onKeyDown={stop}
      onKeyUp={stop}
    >
      {status === 'loading' && <div class="sl-status">{state.statusMessage.value}</div>}
      {status === 'error' && <div class="sl-status sl-status-error">{state.statusMessage.value}</div>}

      {status === 'ready' && s.enabled && cue && (
        <div class="sl-captions">
          <div class="sl-primary" lang={s.primaryLang}>
            {tokenize(cue.text, baseLang(s.primaryLang)).map((t, i) =>
              t.word ? (
                <span key={i} class="sl-word" onClick={(e) => onWord(t.word!, e)}>
                  {t.text}
                </span>
              ) : (
                <span key={i}>{t.text}</span>
              ),
            )}
          </div>
          {s.showSecondary && secondary && (
            <div class={`sl-secondary${s.blurSecondary ? ' sl-blur' : ''}`} lang={s.secondaryLang}>
              {secondary}
            </div>
          )}
        </div>
      )}

      {status === 'ready' && s.enabled && (
        <button class="sl-badge" title="Sublingo · click to toggle the translation line (W)" onClick={actions.onToggleSecondary}>
          {state.primaryLabel.value}
          {state.secondaryLabel.value ? ` · ${state.secondaryLabel.value}` : ''}
          {!s.showSecondary && ' (hidden)'}
        </button>
      )}

      {popup && <WordPopup popup={popup} actions={actions} />}
    </div>
  );
}
