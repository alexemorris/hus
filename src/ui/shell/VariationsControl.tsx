import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { RoomZoneId } from '../../core/types/topology.ts';
import type { RoomVariationGroupInfo } from '../../core/types/variations.ts';
import {
  currentRoomId,
  roomPanelOpen,
  roomVariations,
  skyHudPopover,
  variationsPopoverOpen,
  viewMode,
} from '../../state/shell-store.ts';
import { Icon } from './icons.tsx';
import { useShell } from './shell-context.ts';

function VariationGroupCard(props: {
  readonly group: RoomVariationGroupInfo;
  readonly showFocusButton: boolean;
  readonly compact?: boolean;
}): JSX.Element {
  const ctl = useShell();
  const { group, showFocusButton, compact = false } = props;
  const activeOption = group.options.find((o) => o.id === group.activeOptionId) ?? group.options[0];
  const isModified = group.activeOptionId !== group.defaultOptionId;

  return (
    <div
      class={`shell-var-group${isModified ? ' is-modified' : ''}${compact ? ' is-compact' : ''}`}
      onPointerEnter={() => {
        if (showFocusButton && group.zoneId) ctl.highlightRoom(group.zoneId);
      }}
      onPointerLeave={() => {
        if (showFocusButton && group.zoneId) ctl.highlightRoom(null);
      }}
    >
      <div class="shell-var-group-head">
        <div class="shell-var-group-title-wrap">
          <span class="shell-var-group-title">{group.label}</span>
          {showFocusButton && group.zoneId && (
            <span class="shell-var-room-tag">{ctl.roomLabel(group.zoneId)}</span>
          )}
        </div>
        <div class="shell-var-group-actions">
          {showFocusButton && group.zoneId && (
            <button
              type="button"
              class="shell-icon-btn shell-icon-btn-sm"
              title={`Focus ${ctl.roomLabel(group.zoneId)}`}
              aria-label={`Focus ${ctl.roomLabel(group.zoneId)}`}
              onClick={() => {
                ctl.highlightRoom(null);
                ctl.selectRoom(group.zoneId!);
              }}
            >
              <Icon name="target" size={13} />
            </button>
          )}
          <div class="shell-var-cycle" role="group" aria-label={`Cycle ${group.label}`}>
            <button
              type="button"
              class="shell-icon-btn shell-icon-btn-sm"
              title="Previous option"
              aria-label={`Previous ${group.label} option`}
              disabled={group.options.length < 2}
              onClick={() => ctl.cycleVariationOption(group.id, -1)}
            >
              <Icon name="chevron-left" size={14} />
            </button>
            <button
              type="button"
              class="shell-icon-btn shell-icon-btn-sm"
              title="Next option"
              aria-label={`Next ${group.label} option`}
              disabled={group.options.length < 2}
              onClick={() => ctl.cycleVariationOption(group.id, 1)}
            >
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        </div>
      </div>

      <div class="shell-var-pills" role="radiogroup" aria-label={group.label}>
        {group.options.map((opt) => {
          const isActive = opt.id === group.activeOptionId;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              class={`shell-var-pill${isActive ? ' is-active' : ''}`}
              title={opt.description ? `${opt.label} — ${opt.description}` : opt.label}
              onClick={() => ctl.selectVariationOption(group.id, opt.id)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {activeOption?.description && (
        <p class="shell-var-desc">{activeOption.description}</p>
      )}
    </div>
  );
}

/**
 * TopBar compact button for Room / Design Variations.
 * Renders nothing when the active house defines 0 variations.
 */
export function TopBarVariationsButton(): JSX.Element | null {
  const groups = roomVariations.value;
  if (groups.length === 0) return null;

  const roomId = currentRoomId.value;
  const roomGroups = roomId ? groups.filter((g) => g.zoneId === roomId) : [];
  const modifiedCount = groups.filter((g) => g.activeOptionId !== g.defaultOptionId).length;
  const open = variationsPopoverOpen.value;

  const activeRoomGroup = roomGroups.length === 1 ? roomGroups[0] : undefined;
  const activeRoomOpt = activeRoomGroup?.options.find((o) => o.id === activeRoomGroup.activeOptionId);

  return (
    <button
      type="button"
      class={`shell-btn shell-var-topbar-btn${open ? ' is-active' : ''}${
        modifiedCount > 0 || roomGroups.length > 0 ? ' has-badge' : ''
      }`}
      aria-expanded={open}
      aria-haspopup="dialog"
      title={
        activeRoomGroup && activeRoomOpt
          ? `Design variations · ${activeRoomGroup.label}: ${activeRoomOpt.label}`
          : `Design variations (${groups.length})`
      }
      onClick={() => {
        const next = !variationsPopoverOpen.value;
        if (next) skyHudPopover.value = 'none';
        variationsPopoverOpen.value = next;
      }}
    >
      <Icon name="layers" size={15} />
      <span class="shell-btn-label">
        {activeRoomOpt ? activeRoomOpt.label : 'Variations'}
      </span>
      <span class={`shell-var-count-badge${modifiedCount > 0 ? ' is-modified' : ''}`}>
        {groups.length}
      </span>
    </button>
  );
}

/**
 * Glassmorphic popover listing all Room / Design Variation groups across the house.
 */
export function VariationsPopover(): JSX.Element | null {
  const ctl = useShell();
  const groups = roomVariations.value;
  const open = variationsPopoverOpen.value;
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.shell-var-topbar-btn')) return;
      variationsPopoverOpen.value = false;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  if (!open || groups.length === 0) return null;

  const roomId = currentRoomId.value;
  const anyModified = groups.some((g) => g.activeOptionId !== g.defaultOptionId);
  // Sort current room's variation groups to the top when viewing a room with variations
  const sortedGroups = roomId
    ? [
        ...groups.filter((g) => g.zoneId === roomId),
        ...groups.filter((g) => g.zoneId !== roomId),
      ]
    : groups;

  return (
    <section
      ref={popRef}
      class="shell-var-popover shell-glass"
      role="dialog"
      aria-label="Design variations"
    >
      <div class="shell-var-popover-head">
        <span class="shell-card-title">
          <Icon name="layers" size={15} /> Design variations
        </span>
        <div class="shell-var-popover-actions">
          {anyModified && (
            <button
              type="button"
              class="shell-chip"
              title="Reset all variations to their default options"
              onClick={() => ctl.resetVariationDefaults()}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            class="shell-icon-btn shell-icon-btn-sm"
            title="Close variations"
            aria-label="Close variations"
            onClick={() => {
              variationsPopoverOpen.value = false;
            }}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>

      <div class="shell-var-popover-list">
        {sortedGroups.map((group) => (
          <VariationGroupCard
            key={group.id}
            group={group}
            showFocusButton={Boolean(group.zoneId && group.zoneId !== roomId)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Inline RoomPanel section: surfaces room-specific variations right at the top of `RoomPanel`
 * when viewing a room with `zoneId` matches, or shows a compact property-wide variations card
 * when no room is selected. Renders nothing when no matching variations exist.
 */
export function RoomVariationsSection(props: {
  readonly roomId: RoomZoneId | null;
}): JSX.Element | null {
  const ctl = useShell();
  const allGroups = roomVariations.value;
  if (allGroups.length === 0) return null;

  const groups = props.roomId
    ? allGroups.filter((g) => g.zoneId === props.roomId)
    : allGroups;
  if (groups.length === 0) return null;

  const anyModified = groups.some((g) => g.activeOptionId !== g.defaultOptionId);

  return (
    <section class="shell-card shell-card-variations" aria-label="Design variations">
      <div class="shell-card-head">
        <span class="shell-card-title">
          <Icon name="layers" size={15} />{' '}
          {props.roomId ? 'Design options' : 'Design variations'}
        </span>
        {anyModified && props.roomId === null && (
          <button
            type="button"
            class="shell-chip"
            onClick={() => ctl.resetVariationDefaults()}
          >
            Reset
          </button>
        )}
      </div>
      <div class="shell-var-section-list">
        {groups.map((group) => (
          <VariationGroupCard
            key={group.id}
            group={group}
            showFocusButton={props.roomId === null && Boolean(group.zoneId)}
            compact
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Contextual floating HUD pill shown when the user is inside/viewing a room that has
 * variations while `RoomPanel` is closed (e.g. mobile, walkthrough mode, or collapsed sidebar),
 * making 1-click option switching effortless without opening drawers.
 */
export function FloatingRoomVariationHud(): JSX.Element | null {
  const ctl = useShell();
  const groups = roomVariations.value;
  if (groups.length === 0) return null;

  const roomId = currentRoomId.value;
  if (!roomId) return null;

  // Hide when RoomPanel is already open on screen or the TopBar popover is open
  if (variationsPopoverOpen.value) return null;
  if (roomPanelOpen.value && viewMode.value !== 'walk') return null;

  const roomGroups = groups.filter((g) => g.zoneId === roomId);
  if (roomGroups.length === 0) return null;

  const primary = roomGroups[0]!;

  return (
    <div class="shell-var-floating-hud shell-glass" role="region" aria-label={`${primary.label} options`}>
      <button
        type="button"
        class="shell-icon-btn shell-icon-btn-sm"
        title={`Previous ${primary.label} option`}
        aria-label={`Previous ${primary.label} option`}
        onClick={() => ctl.cycleVariationOption(primary.id, -1)}
      >
        <Icon name="chevron-left" size={14} />
      </button>
      <div class="shell-var-floating-meta">
        <span class="shell-var-floating-eyebrow">{primary.label}</span>
        <div class="shell-var-floating-pills" role="radiogroup" aria-label={primary.label}>
          {primary.options.map((opt) => {
            const isActive = opt.id === primary.activeOptionId;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                class={`shell-var-pill shell-var-pill-sm${isActive ? ' is-active' : ''}`}
                onClick={() => ctl.selectVariationOption(primary.id, opt.id)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        class="shell-icon-btn shell-icon-btn-sm"
        title={`Next ${primary.label} option`}
        aria-label={`Next ${primary.label} option`}
        onClick={() => ctl.cycleVariationOption(primary.id, 1)}
      >
        <Icon name="chevron-right" size={14} />
      </button>
      {roomGroups.length > 1 && (
        <button
          type="button"
          class="shell-chip"
          title="Show all room variations"
          onClick={() => {
            variationsPopoverOpen.value = true;
          }}
        >
          +{roomGroups.length - 1}
        </button>
      )}
    </div>
  );
}
