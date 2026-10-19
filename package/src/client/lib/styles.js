/**
 * The plugin's stylesheet, as one string injected once per mount.
 *
 * Every colour is a Harness theme token (`--dsw-alias-*`), so light/dark
 * switching, high contrast, and any future token rename all work without the
 * plugin doing anything. Class names are prefixed `sc-` so they cannot collide
 * with host styles.
 * @module client/lib/styles
 */

export const CSS = `
.sc-root { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family, inherit); }

.sc-header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--dsw-alias-border-l1); flex: 0 0 auto; flex-wrap: wrap; }
.sc-title { font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
.sc-subtitle { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.sc-spacer { flex: 1 1 auto; }

.sc-tabs { display: flex; gap: 2px; padding: 0 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); overflow-x: auto; flex: 0 0 auto; scrollbar-width: none; }
.sc-tabs::-webkit-scrollbar { display: none; }
.sc-tab { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; padding: 10px 12px; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; border-radius: 6px 6px 0 0; }
.sc-tab:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.08)); }
.sc-tab[aria-selected="true"] { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); font-weight: 600; }
.sc-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }

.sc-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 18px 20px 40px; }
.sc-body-flush { padding: 0; }

.sc-grid { display: grid; gap: 12px; }
.sc-grid-kpi { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
.sc-grid-2 { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.sc-grid-3 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }

.sc-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.sc-card-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dsw-alias-label-secondary); margin: 0 0 8px; font-weight: 600; }
.sc-card-value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.15; }
.sc-card-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 4px; font-variant-numeric: tabular-nums; }
.sc-up { color: var(--dsw-alias-state-success-primary); }
.sc-down { color: var(--dsw-alias-state-error-primary); }
.sc-flat { color: var(--dsw-alias-label-secondary); }

.sc-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-row-tight { display: flex; align-items: center; gap: 6px; }
.sc-stack { display: flex; flex-direction: column; gap: 10px; }

.sc-btn { appearance: none; font: inherit; font-size: 13px; border-radius: 7px; padding: 6px 12px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); display: inline-flex; align-items: center; gap: 6px; transition: background 120ms ease, border-color 120ms ease; }
.sc-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1)); }
.sc-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sc-btn-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.sc-btn-primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--dsw-alias-brand-primary); }
.sc-btn-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.sc-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
.sc-btn-ghost { border-color: transparent; background: transparent; }
.sc-btn-sm { padding: 3px 8px; font-size: 12px; }

.sc-input, .sc-select, .sc-textarea { font: inherit; font-size: 13px; padding: 6px 9px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); min-width: 0; }
.sc-input:focus, .sc-select:focus, .sc-textarea:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.sc-textarea { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; resize: vertical; min-height: 80px; width: 100%; box-sizing: border-box; }
.sc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.sc-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.sc-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.sc-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); }

.sc-table-wrap { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: auto; background: var(--dsw-alias-bg-layer-1); }
.sc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.sc-table th { position: sticky; top: 0; background: var(--dsw-alias-bg-layer-2); text-align: left; font-weight: 600; font-size: 11.5px; color: var(--dsw-alias-label-secondary); padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); white-space: nowrap; z-index: 1; }
.sc-table th.sc-num, .sc-table td.sc-num { text-align: right; }
.sc-table td { padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); white-space: nowrap; }
.sc-table tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.06)); }
.sc-table tbody tr:last-child td { border-bottom: 0; }
.sc-table td.sc-wrap { white-space: normal; min-width: 160px; }
.sc-mono { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11.5px; }

.sc-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.sc-badge-ok { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); }
.sc-badge-warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); }
.sc-badge-err { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); }
.sc-badge-brand { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); }

.sc-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 20px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.sc-empty-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }

.sc-spinner { width: 15px; height: 15px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); animation: sc-spin 700ms linear infinite; display: inline-block; }
@keyframes sc-spin { to { transform: rotate(360deg); } }

.sc-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
@media (min-width: 1100px) { .sc-split { grid-template-columns: minmax(0, 1fr) 380px; } }

.sc-chart { width: 100%; height: auto; display: block; overflow: visible; }
.sc-chart-grid { stroke: var(--dsw-alias-border-l1); stroke-width: 1; }
.sc-chart-axis { fill: var(--dsw-alias-label-secondary); font-size: 10px; }
.sc-chart-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.sc-chart-area { opacity: 0.14; }

.sc-heat { display: grid; grid-template-columns: 44px repeat(24, minmax(20px, 1fr)); gap: 2px; font-size: 10px; }
.sc-heat-label { color: var(--dsw-alias-label-secondary); display: flex; align-items: center; font-size: 10.5px; }
.sc-heat-cell { aspect-ratio: 1 / 1; border-radius: 3px; border: 0; padding: 0; cursor: pointer; position: relative; min-height: 20px; }
.sc-heat-cell:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sc-heat-cell[data-selected="true"] { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.sc-heat-hour { text-align: center; color: var(--dsw-alias-label-secondary); font-size: 9.5px; }

.sc-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.42); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 20px; }
.sc-modal { background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,0.35); width: min(760px, 100%); max-height: 88vh; display: flex; flex-direction: column; }
.sc-modal-header { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.sc-modal-title { font-size: 14px; font-weight: 600; }
.sc-modal-body { padding: 16px 18px; overflow: auto; }
.sc-modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--dsw-alias-border-l1); }

.sc-calc { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; }
.sc-calc-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 3px 0; border-bottom: 1px dashed var(--dsw-alias-border-l1); }
.sc-calc-row:last-child { border-bottom: 0; }
.sc-calc-step { color: var(--dsw-alias-label-secondary); }
.sc-calc-value { font-variant-numeric: tabular-nums; font-family: var(--dsw-font-mono, ui-monospace, monospace); }

.sc-diff { display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
.sc-diff-before { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }
.sc-diff-arrow { color: var(--dsw-alias-label-secondary); }
.sc-diff-after { font-weight: 600; }

.sc-toast { position: fixed; right: 20px; bottom: 20px; z-index: 80; display: flex; flex-direction: column; gap: 8px; max-width: 420px; }
.sc-toast-item { background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; padding: 10px 13px; font-size: 12.5px; box-shadow: 0 10px 28px rgba(0,0,0,0.28); }
.sc-toast-err { border-color: var(--dsw-alias-state-error-primary); }
.sc-toast-ok { border-color: var(--dsw-alias-state-success-primary); }

.sc-banner { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); font-size: 12.5px; }
.sc-banner-warn { border-color: var(--dsw-alias-state-warn-primary); }
.sc-banner-info { border-color: var(--dsw-alias-brand-primary); }

.sc-switch { position: relative; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; font-size: 12.5px; }
.sc-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.sc-switch-track { width: 32px; height: 18px; border-radius: 999px; background: var(--dsw-alias-border-l2); position: relative; transition: background 140ms ease; flex: 0 0 auto; }
.sc-switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--dsw-alias-bg-base); transition: transform 140ms ease; }
.sc-switch input:checked + .sc-switch-track { background: var(--dsw-alias-brand-primary); }
.sc-switch input:checked + .sc-switch-track::after { transform: translateX(14px); }
.sc-switch input:focus-visible + .sc-switch-track { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

.sc-pill-row { display: flex; gap: 6px; flex-wrap: wrap; }
.sc-chip { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.sc-chip-on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }

.sc-progress { height: 4px; border-radius: 999px; background: var(--dsw-alias-border-l1); overflow: hidden; }
.sc-progress-bar { height: 100%; background: var(--dsw-alias-brand-primary); transition: width 200ms ease; }

.sc-metric-picker { max-height: 220px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.sc-metric-option { text-align: left; border: 0; background: transparent; font: inherit; font-size: 12px; padding: 5px 8px; border-radius: 5px; cursor: pointer; color: var(--dsw-alias-label-primary); display: flex; justify-content: space-between; gap: 10px; }
.sc-metric-option:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.1)); }
.sc-metric-option[aria-selected="true"] { background: var(--dsw-alias-brand-primary); color: #fff; }
.sc-metric-unit { opacity: 0.65; font-size: 11px; }

.sc-side-list { display: flex; flex-direction: column; gap: 4px; max-height: 340px; overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 6px; }
.sc-side-item { display: flex; gap: 8px; align-items: center; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 12.5px; }
.sc-side-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.08)); }
.sc-side-item input { margin: 0; }

.sc-kbd { font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 11px; border: 1px solid var(--dsw-alias-border-l2); border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; }
`;
