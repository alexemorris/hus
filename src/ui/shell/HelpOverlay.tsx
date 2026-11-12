import type { JSX } from 'preact';
import { helpOpen, helpStep, markHelpSeen } from '../../state/shell-store.ts';
import { Icon, type IconName } from './icons.tsx';

const STEPS: readonly { readonly icon: IconName; readonly title: string; readonly body: string; readonly tips: readonly string[] }[] = [
  {
    icon: 'hand',
    title: 'Move around',
    body: 'Drag to orbit, right-drag to pan and scroll to zoom. Lost? Press F or Recenter.',
    tips: ['Ground / First / All switches floors (1, 2, 3)', 'Walk lets you explore at eye level (W)'],
  },
  {
    icon: 'house',
    title: 'Pick a room',
    body: 'Choose a room from the list on the left, or double-click inside the model.',
    tips: ['The right panel shows that room’s lights, heating and notes', 'Whole house has All off, Evening and Gates'],
  },
  {
    icon: 'pin',
    title: 'Leave a note',
    body: 'Choose Note in the bottom toolbar (N) and click any surface to pin a comment.',
    tips: ['Assign notes to a trade and export them as Markdown', 'Share copies a link to exactly what you’re looking at'],
  },
];

export function HelpOverlay(): JSX.Element | null {
  if (!helpOpen.value) return null;
  const step = Math.min(STEPS.length - 1, Math.max(0, helpStep.value));
  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const close = (): void => {
    helpOpen.value = false;
    markHelpSeen();
  };

  return (
    <div class="shell-modal-backdrop shell-help-backdrop" onClick={close}>
      <div
        class="shell-help shell-glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shell-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" class="shell-icon-btn shell-help-close" aria-label="Close help" onClick={close}>
          <Icon name="close" />
        </button>
        <div class="shell-help-icon">
          <Icon name={s.icon} size={30} />
        </div>
        <p class="shell-help-step">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 id="shell-help-title">{s.title}</h2>
        <p class="shell-help-body">{s.body}</p>
        <ul class="shell-help-tips">
          {s.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div class="shell-help-dots" role="tablist" aria-label="Tutorial steps">
          {STEPS.map((x, i) => (
            <button
              key={x.title}
              type="button"
              role="tab"
              aria-selected={i === step}
              aria-label={`Step ${i + 1}: ${x.title}`}
              class={`shell-help-dot${i === step ? ' is-active' : ''}`}
              onClick={() => {
                helpStep.value = i;
              }}
            />
          ))}
        </div>
        <div class="shell-help-actions">
          <button type="button" class="shell-btn" onClick={close}>
            Skip
          </button>
          <div class="shell-help-nav">
            {step > 0 && (
              <button
                type="button"
                class="shell-btn"
                onClick={() => {
                  helpStep.value = step - 1;
                }}
              >
                Back
              </button>
            )}
            <button
              type="button"
              class="shell-btn shell-btn-primary"
              onClick={() => {
                if (isLast) close();
                else helpStep.value = step + 1;
              }}
            >
              {isLast ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
