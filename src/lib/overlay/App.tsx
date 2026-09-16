import { baseLang } from '@/lib/subtitles/types';
import { tokenize, type Token } from '@/lib/subtitles/tokenize';
import { WordPopup } from './WordPopup';
import { primaryCue, secondaryText, state } from './store';

export interface OverlayActions {
  onWordClick(word: string, sentence: string, x: number, y: number): void;
  onClosePopup(): void;
  onSave(): void;
  onToggleSecondary(): void;
  onLookupLemma(lemma: string): void;
  onCaptionHover(entering: boolean): void;
}

const stop = (e: Event) => e.stopPropagation();

const safeTokenize = (text: string, lang: string): Token[] => {
  try {
    return tokenize(text, lang);
  } catch {
    return [{ text }];
  }
};

export function App({ actions }: { actions: OverlayActions }) {
  const s = state.settings.value;
  const cue = primaryCue.value;
  const secondary = secondaryText.value;
  const status = state.status.value;
  const popup = state.popup.value;
  const mtStatus = state.mtStatus.value;

  const onWord = (word: string, e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const root = el.closest('.sl-root') as HTMLElement | null;
    const r = el.getBoundingClientRect();
    const rr = root?.getBoundingClientRect() ?? { left: 0, top: 0 };
    actions.onWordClick(word, cue?.text ?? '', r.left - rr.left + r.width / 2, r.top - rr.top);
  };

  const rootStyle = {
    '--sl-scale': String(s.fontSize / 100),
    '--sl-offset': `${s.captionOffset}%`,
  } as Record<string, string>;

  return (
    <div class="sl-root" style={rootStyle} onMouseDown={stop} onMouseUp={stop} onClick={stop} onDblClick={stop} onKeyDown={stop} onKeyUp={stop}>
      {status === 'loading' && <div class="sl-status">{state.statusMessage.value}</div>}
      {status === 'error' && <div class="sl-status sl-status-error">{state.statusMessage.value}</div>}
      {status === 'ready' && mtStatus && <div class="sl-status sl-status-mt">{mtStatus}</div>}

      {status === 'ready' && s.enabled && cue && (
        <div class="sl-captions" onMouseEnter={() => actions.onCaptionHover(true)} onMouseLeave={() => actions.onCaptionHover(false)}>
          <div class="sl-primary" lang={s.primaryLang}>
            {safeTokenize(cue.text, baseLang(s.primaryLang)).map((t, i) =>
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
