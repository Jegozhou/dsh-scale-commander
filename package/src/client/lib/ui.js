/**
 * Small, dependency-free building blocks shared by every view.
 *
 * They are plain function components so the plugin needs no primitives import;
 * styling comes from the plugin's own stylesheet, which reads Harness theme
 * tokens. Anything interactive is a real button, input, or select so keyboard
 * and screen-reader behaviour is the platform's.
 * @module client/lib/ui
 */

import React from 'react';
import { formatMetric, METRIC_LABELS } from '../../shared/metrics.js';

const h = React.createElement;

/**
 * @param {{children?: any, className?: string, flush?: boolean}} props
 */
export function Panel({ children, className, flush }) {
  return h('div', { className: ['sc-root', className].filter(Boolean).join(' ') }, children);
}

/**
 * @param {{title: string, subtitle?: string, actions?: any, children?: any}} props
 */
export function Header({ title, subtitle, actions, children }) {
  return h('div', { className: 'sc-header' },
    h('div', { className: 'sc-stack', style: { gap: 2 } },
      h('div', { className: 'sc-title' }, title),
      subtitle === undefined ? null : h('div', { className: 'sc-subtitle' }, subtitle),
    ),
    h('div', { className: 'sc-spacer' }),
    actions,
    children,
  );
}

/**
 * A tab strip that owns no state; the parent decides which view renders.
 * @param {{tabs: Array<{id: string, label: string, badge?: string|number}>, active: string, onChange: (id: string) => void}} props
 */
export function Tabs({ tabs, active, onChange }) {
  return h('div', { className: 'sc-tabs', role: 'tablist' },
    tabs.map((tab) => h('button', {
      key: tab.id,
      type: 'button',
      role: 'tab',
      'aria-selected': tab.id === active,
      className: 'sc-tab',
      onClick: () => onChange(tab.id),
    }, tab.label, tab.badge === undefined || tab.badge === '' ? null : h('span', {
      className: 'sc-badge',
      style: { marginLeft: 6 },
    }, String(tab.badge)))),
  );
}

/**
 * @param {{label: string, value: any, meta?: string, delta?: number|null, format?: string, currency?: string, tone?: 'up-good'|'down-good'}} props
 */
export function Kpi({ label, value, meta, delta, format = 'number', currency = 'USD', tone = 'up-good' }) {
  const rendered = format === 'currency'
    ? formatMetric('spend', value, { currency, compact: Math.abs(Number(value)) >= 10000 })
    : format === 'percent'
      ? formatMetric('acos', value)
      : format === 'ratio'
        ? (value === null || value === undefined ? '—' : Number(value).toFixed(2))
        : formatMetric('clicks', value);
  const deltaClass = delta === null || delta === undefined || !Number.isFinite(delta)
    ? 'sc-flat'
    : (delta === 0 ? 'sc-flat' : ((delta > 0) === (tone === 'up-good') ? 'sc-up' : 'sc-down'));
  return h('div', { className: 'sc-card' },
    h('div', { className: 'sc-card-title' }, label),
    h('div', { className: 'sc-card-value' }, rendered),
    meta === undefined && delta === undefined
      ? null
      : h('div', { className: 'sc-card-meta' },
        delta === null || delta === undefined ? null : h('span', { className: deltaClass }, `${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${Math.abs(delta).toFixed(1)}%`),
        delta !== null && delta !== undefined && meta !== undefined ? ' · ' : null,
        meta),
  );
}

/**
 * @param {{children?: any, title?: string, actions?: any, className?: string}} props
 */
export function Card({ children, title, actions, className }) {
  return h('div', { className: ['sc-card', className].filter(Boolean).join(' ') },
    title === undefined && actions === undefined ? null : h('div', { className: 'sc-row', style: { marginBottom: 10 } },
      title === undefined ? null : h('div', { className: 'sc-card-title', style: { margin: 0 } }, title),
      h('div', { className: 'sc-spacer' }),
      actions),
    children);
}

/**
 * @param {{children: any, variant?: 'primary'|'danger'|'ghost', size?: 'sm', onClick?: Function, disabled?: boolean, title?: string, type?: string}} props
 */
export function Button({ children, variant, size, onClick, disabled, title, type = 'button' }) {
  return h('button', {
    type,
    className: ['sc-btn', variant === 'primary' ? 'sc-btn-primary' : variant === 'danger' ? 'sc-btn-danger' : variant === 'ghost' ? 'sc-btn-ghost' : '', size === 'sm' ? 'sc-btn-sm' : ''].filter(Boolean).join(' '),
    onClick,
    disabled: disabled === true,
    title,
  }, children);
}

/**
 * @param {{label: string, children: any, hint?: string, error?: string}} props
 */
export function Field({ label, children, hint, error }) {
  return h('label', { className: 'sc-field' },
    h('span', { className: 'sc-label' }, label),
    children,
    hint === undefined ? null : h('span', { className: 'sc-hint' }, hint),
    error === undefined ? null : h('span', { className: 'sc-error' }, error),
  );
}

/**
 * @param {{value: any, onChange: Function, options: Array<{value: string, label: string}>, ariaLabel?: string, style?: any}} props
 */
export function Select({ value, onChange, options, ariaLabel, style }) {
  return h('select', {
    className: 'sc-select',
    value: value ?? '',
    'aria-label': ariaLabel,
    style,
    onChange: (event) => onChange(event.target.value),
  }, options.map((option) => h('option', { key: option.value, value: option.value }, option.label)));
}

/**
 * @param {{value: any, onChange: Function, type?: string, placeholder?: string, ariaLabel?: string, style?: any, min?: number, max?: number, step?: number, disabled?: boolean}} props
 */
export function Input({ value, onChange, type = 'text', placeholder, ariaLabel, style, min, max, step, disabled }) {
  return h('input', {
    className: 'sc-input',
    type,
    value: value ?? '',
    placeholder,
    'aria-label': ariaLabel,
    style,
    min,
    max,
    step,
    disabled: disabled === true,
    onChange: (event) => onChange(type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value),
  });
}

/**
 * A plain multi-line input; used where a list is typed one item per line.
 * @param {{value: string, onChange: (next: string) => void, rows?: number, placeholder?: string, ariaLabel?: string}} props
 */
export function Textarea({ value, onChange, rows = 4, placeholder, ariaLabel }) {
  return h('textarea', {
    className: 'sc-textarea',
    value: value ?? '',
    rows,
    placeholder,
    'aria-label': ariaLabel,
    onChange: (event) => onChange(event.target.value),
  });
}

/**
 * @param {{value: boolean, onChange: (next: boolean) => void, label: string, disabled?: boolean}} props
 */
export function Switch({ value, onChange, label, disabled }) {
  return h('label', { className: 'sc-switch' },
    h('input', {
      type: 'checkbox',
      checked: value === true,
      disabled: disabled === true,
      onChange: (event) => onChange(event.target.checked),
    }),
    h('span', { className: 'sc-switch-track', 'aria-hidden': 'true' }),
    h('span', null, label),
  );
}

/**
 * @param {{children: any, tone?: 'ok'|'warn'|'err'|'brand'}} props
 */
export function Badge({ children, tone }) {
  const className = tone === 'ok' ? 'sc-badge sc-badge-ok' : tone === 'warn' ? 'sc-badge sc-badge-warn' : tone === 'err' ? 'sc-badge sc-badge-err' : tone === 'brand' ? 'sc-badge sc-badge-brand' : 'sc-badge';
  return h('span', { className }, children);
}

/**
 * @param {{title: string, body?: string, action?: any}} props
 */
export function Empty({ title, body, action }) {
  return h('div', { className: 'sc-empty' },
    h('div', { className: 'sc-empty-title' }, title),
    body === undefined ? null : h('div', null, body),
    action);
}

/**
 * @param {{label?: string}} props
 */
export function Spinner({ label }) {
  return h('span', { className: 'sc-row-tight', role: 'status', 'aria-live': 'polite' },
    h('span', { className: 'sc-spinner', 'aria-hidden': 'true' }),
    label === undefined ? null : h('span', { className: 'sc-subtitle' }, label));
}

/**
 * @param {{columns: Array<{key: string, label: string, numeric?: boolean, wrap?: boolean, render?: Function, width?: string}>, rows: Array<Record<string, any>>, rowKey?: (row: any, index: number) => string, onRowClick?: Function, empty?: any, caption?: string}} props
 */
export function Table({ columns, rows, rowKey, onRowClick, empty, caption }) {
  if (rows.length === 0) return empty ?? h(Empty, { title: 'No rows', body: 'Nothing matches the current filters.' });
  return h('div', { className: 'sc-table-wrap' },
    h('table', { className: 'sc-table' },
      caption === undefined ? null : h('caption', { style: { captionSide: 'top', textAlign: 'left', padding: '8px 10px', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, caption),
      h('thead', null, h('tr', null, columns.map((column) => h('th', {
        key: column.key,
        className: column.numeric === true ? 'sc-num' : undefined,
        style: column.width === undefined ? undefined : { width: column.width },
      }, column.label)))),
      h('tbody', null, rows.map((row, index) => h('tr', {
        key: rowKey === undefined ? String(index) : rowKey(row, index),
        onClick: onRowClick === undefined ? undefined : () => onRowClick(row),
        style: onRowClick === undefined ? undefined : { cursor: 'pointer' },
      }, columns.map((column) => h('td', {
        key: column.key,
        className: [column.numeric === true ? 'sc-num' : '', column.wrap === true ? 'sc-wrap' : ''].filter(Boolean).join(' ') || undefined,
      }, column.render === undefined ? row[column.key] : column.render(row)))))),
    ),
  );
}

/**
 * A modal that traps focus on open, closes on Escape and on backdrop click.
 * @param {{title: string, children: any, onClose: Function, footer?: any, width?: number}} props
 */
export function Modal({ title, children, onClose, footer, width }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const node = ref.current;
    if (node !== null) node.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return h('div', {
    className: 'sc-modal-backdrop',
    onMouseDown: (event) => {
      if (event.target === event.currentTarget) onClose();
    },
  }, h('div', {
    className: 'sc-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
    tabIndex: -1,
    ref,
    style: width === undefined ? undefined : { width: `min(${width}px, 100%)` },
  },
  h('div', { className: 'sc-modal-header' },
    h('div', { className: 'sc-modal-title' }, title),
    h('div', { className: 'sc-spacer' }),
    h(Button, { variant: 'ghost', size: 'sm', onClick: onClose, title: 'Close' }, '✕'),
  ),
  h('div', { className: 'sc-modal-body' }, children),
  footer === undefined ? null : h('div', { className: 'sc-modal-footer' }, footer),
  ));
}

/**
 * @param {{value: number|null|undefined, metric: string, currency?: string, before?: any}} props
 */
export function Metric({ value, metric, currency }) {
  return h('span', null, formatMetric(metric, value, { currency }));
}

/**
 * @param {{before: any, after: any, metric: string, currency?: string}} props
 */
export function Diff({ before, after, metric, currency }) {
  const format = (value) => {
    if (typeof value === 'number') return formatMetric(metric, value, { currency });
    if (value === null || value === undefined) return '—';
    return String(value);
  };
  return h('span', { className: 'sc-diff' },
    h('span', { className: 'sc-diff-before' }, format(before)),
    h('span', { className: 'sc-diff-arrow' }, '→'),
    h('span', { className: 'sc-diff-after' }, format(after)),
  );
}

/**
 * The step-by-step maths behind one action.
 * @param {{steps: Array<{step: string, expression?: string, value?: any}>}} props
 */
export function Calculation({ steps }) {
  if (!Array.isArray(steps) || steps.length === 0) return h('span', { className: 'sc-hint' }, 'no calculation recorded');
  return h('div', { className: 'sc-calc' }, steps.map((step, index) => h('div', { className: 'sc-calc-row', key: index },
    h('span', { className: 'sc-calc-step' }, step.step, step.expression === undefined ? null : h('span', { className: 'sc-mono', style: { marginLeft: 6, opacity: 0.8 } }, step.expression)),
    h('span', { className: 'sc-calc-value' }, step.value === null || step.value === undefined ? '—' : String(step.value)),
  )));
}

/**
 * @param {{message: string, tone?: 'ok'|'err'}} props
 */
export function Toast({ message, tone }) {
  return h('div', { className: `sc-toast-item ${tone === 'err' ? 'sc-toast-err' : 'sc-toast-ok'}`, role: 'status' }, message);
}

/**
 * @param {{children: any, tone?: 'warn'|'info'}} props
 */
export function Banner({ children, tone }) {
  return h('div', { className: `sc-banner ${tone === 'warn' ? 'sc-banner-warn' : 'sc-banner-info'}`, role: 'note' },
    h('span', { 'aria-hidden': 'true' }, tone === 'warn' ? '⚠' : 'ⓘ'),
    h('div', null, children));
}

/**
 * A single-series line chart with a grid and hover readout, drawn as SVG.
 * @param {{points: Array<{x: string, y: number|null}>, height?: number, label: string, currency?: string, metric?: string}} props
 */
export function LineChart({ points, height = 150, label, currency, metric = 'spend' }) {
  const [hover, setHover] = React.useState(null);
  const width = 640;
  const padding = { top: 12, right: 12, bottom: 20, left: 44 };
  const values = points.map((point) => Number(point.y ?? 0));
  const max = Math.max(1, ...values);
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const step = points.length <= 1 ? 0 : innerW / (points.length - 1);
  const coords = points.map((point, index) => ({
    x: padding.left + index * step,
    y: padding.top + innerH - ((Number(point.y ?? 0) / max) * innerH),
    point,
  }));
  const path = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(' ');
  const area = coords.length === 0 ? '' : `${path} L${coords[coords.length - 1].x.toFixed(1)},${(padding.top + innerH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padding.top + innerH).toFixed(1)} Z`;
  const ticks = [0, 0.5, 1].map((fraction) => ({ y: padding.top + innerH * (1 - fraction), value: max * fraction }));
  return h('div', { style: { position: 'relative' } },
    h('svg', {
      className: 'sc-chart',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `${label} over ${points.length} days`,
      preserveAspectRatio: 'none',
    },
    ticks.map((tick, index) => h('g', { key: index },
      h('line', { className: 'sc-chart-grid', x1: padding.left, x2: width - padding.right, y1: tick.y, y2: tick.y }),
      h('text', { className: 'sc-chart-axis', x: padding.left - 6, y: tick.y + 3, textAnchor: 'end' }, formatMetric(metric, tick.value, { currency, compact: true })),
    )),
    coords.length > 1 ? h('path', { className: 'sc-chart-area', d: area, fill: 'var(--dsw-alias-brand-primary)' }) : null,
    h('path', { className: 'sc-chart-line', d: path, stroke: 'var(--dsw-alias-brand-primary)' }),
    coords.map((coord, index) => h('circle', {
      key: index,
      cx: coord.x,
      cy: coord.y,
      r: hover === index ? 4 : 2.2,
      fill: 'var(--dsw-alias-brand-primary)',
      onMouseEnter: () => setHover(index),
      onMouseLeave: () => setHover(null),
    })),
    hover === null ? null : h('text', {
      className: 'sc-chart-axis',
      x: Math.min(width - padding.right - 60, Math.max(padding.left, coords[hover].x - 30)),
      y: padding.top + 10,
      textAnchor: 'start',
    }, `${points[hover].x} · ${formatMetric(metric, points[hover].y, { currency })}`),
    ),
  );
}

/**
 * @param {{label: string, metric: string}} props
 */
export function MetricLabel({ label, metric }) {
  return h('span', { title: METRIC_LABELS[metric] ?? metric }, label);
}

/**
 * Format a currency or number for a table cell.
 * @param {number|null|undefined} value
 * @param {string} metric
 * @param {string} [currency]
 * @returns {string}
 */
export function fmt(value, metric, currency) {
  return formatMetric(metric, value, { currency });
}

export { formatMetric };
