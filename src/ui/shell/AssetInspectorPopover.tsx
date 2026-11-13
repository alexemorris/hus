import type { JSX } from 'preact';
import {
  formatAssetDimensionsMm,
  formatAssetPrice,
  resolveAssetLinks,
} from '../../core/assets/asset-metadata.ts';
import {
  assetInspectMode,
  inspectedAssetSnapshot,
} from '../../state/asset-inspector-store.ts';
import { Icon } from './icons.tsx';
import { useShell } from './shell-context.ts';

export function AssetInspectorPopover(): JSX.Element | null {
  const ctl = useShell();
  const snap = inspectedAssetSnapshot.value;
  const modeActive = assetInspectMode.value;

  if (!snap && !modeActive) return null;

  if (!snap) {
    return (
      <aside
        class="shell-inspector shell-glass asset-inspector-panel is-open is-empty"
        aria-label="Asset inspector"
      >
        <header class="shell-inspector-head is-static">
          <span class="shell-inspector-title">Inspect asset</span>
          <span class="shell-pill">Pick an object</span>
          <button
            class="shell-icon-btn shell-icon-btn-sm"
            type="button"
            title="Exit inspect mode (Esc)"
            aria-label="Exit inspect mode"
            onClick={() => ctl.closeAssetInspector()}
          >
            <Icon name="close" size={16} />
          </button>
        </header>
        <div class="hud-body asset-inspector-body">
          <p class="asset-inspector-hint">
            Click any fixture, appliance, window, or furniture item to view its finish, dimensions,
            and product links.
          </p>
        </div>
      </aside>
    );
  }

  const { metadata, roomLabel, actions, hasSpatialAudio } = snap;
  const dimsText = formatAssetDimensionsMm(metadata.dimensionsMm);
  const priceText = formatAssetPrice(metadata.price);
  const links = resolveAssetLinks(metadata);

  return (
    <aside
      class="shell-inspector shell-glass asset-inspector-panel is-open"
      aria-label="Asset inspector"
    >
      <header class="shell-inspector-head is-static">
        <div class="asset-inspector-head-titles">
          {metadata.brand && (
            <span class="asset-inspector-brand">
              {metadata.brand}
              {metadata.collection ? ` · ${metadata.collection}` : ''}
            </span>
          )}
          <span class="shell-inspector-title">{metadata.name}</span>
        </div>
        <button
          class="shell-icon-btn shell-icon-btn-sm"
          type="button"
          title="Close asset inspector (Esc)"
          aria-label="Close asset inspector"
          onClick={() => ctl.closeAssetInspector()}
        >
          <Icon name="close" size={16} />
        </button>
      </header>

      <div class="hud-body asset-inspector-body">
        <section class="hud-section">
          <div class="asset-inspector-badges">
            {metadata.sku && (
              <span class="shell-pill asset-sku-pill" title="Manufacturer SKU">
                SKU {metadata.sku}
              </span>
            )}
            {metadata.category && (
              <span class="shell-pill asset-cat-pill">{metadata.category}</span>
            )}
            {roomLabel && <span class="shell-pill">{roomLabel}</span>}
          </div>

          <dl class="asset-inspector-specs">
            {metadata.finish && (
              <div class="asset-spec-row">
                <dt>Finish</dt>
                <dd>{metadata.finish}</dd>
              </div>
            )}
            {dimsText && (
              <div class="asset-spec-row">
                <dt>Dimensions</dt>
                <dd>{dimsText}</dd>
              </div>
            )}
            {priceText && (
              <div class="asset-spec-row">
                <dt>Guide price</dt>
                <dd>{priceText}</dd>
              </div>
            )}
          </dl>

          {metadata.notes && <p class="asset-inspector-notes">{metadata.notes}</p>}
        </section>

        {(actions.length > 0 || hasSpatialAudio) && (
          <section class="hud-section">
            <div class="asset-inspector-section-label">Controls &amp; sound</div>
            <div class="asset-inspector-actions">
              {actions.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  class={`hud-inline-btn asset-action-btn${act.active ? ' is-active' : ''}`}
                  aria-pressed={act.active}
                  onClick={() => ctl.triggerInspectedAssetAction(act.id)}
                >
                  <Icon name={act.active ? 'check' : 'sparkle'} size={14} />
                  <span>{act.label}</span>
                </button>
              ))}
              {hasSpatialAudio && actions.length === 0 && (
                <button
                  type="button"
                  class="hud-inline-btn asset-action-btn"
                  onClick={() => ctl.playInspectedAssetSound()}
                >
                  <Icon name="volume" size={14} />
                  <span>Play spatial sound</span>
                </button>
              )}
              <button
                type="button"
                class="hud-inline-btn asset-action-btn"
                title="Frame this asset"
                onClick={() => ctl.frameInspectedAsset()}
              >
                <Icon name="target" size={14} />
                <span>Frame</span>
              </button>
            </div>
          </section>
        )}

        {links.length > 0 && (
          <section class="hud-section hud-section-last">
            <div class="asset-inspector-section-label">Product &amp; schematics</div>
            <div class="asset-inspector-links">
              {links.map((link) => (
                <a
                  key={link.url}
                  class={`asset-link-chip kind-${link.kind ?? 'product'}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name={link.kind === 'schematic' ? 'plan' : 'external'} size={14} />
                  <span>{link.label}</span>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
