/**
 * Scale Commander — browser half.
 *
 * Registers one page into the Harness `main` panel and one icon into the
 * sidebar's global panel list, so the product appears as a first-class
 * destination rather than a floating overlay. Styles and dictionaries are
 * registered as effects, so disabling the plugin removes everything.
 * @module client/index
 */

import React from 'react';
import { ScaleCommanderPage } from './panel.js';
import { CSS } from './lib/styles.js';
import { ToastStore } from './lib/state.js';
import { PANEL_ID, LOCALE_NS, EN, ZH } from './locale.js';

const h = React.createElement;

/**
 * The sidebar entry's icon: a rising line with a plus, drawn in currentColor so
 * it follows the host's active/inactive treatment.
 * @param {{size: number}} props
 */
function ScaleCommanderIcon({ size }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
  },
  h('path', { d: 'M3 18.5 9 12l3.5 3L20 6.5' }),
  h('path', { d: 'M15.5 6.5H20V11' }),
  h('path', { d: 'M17 18.5h5M19.5 16v5', opacity: 0.55 }),
  );
}

/**
 * @param {any} ctx
 */
export function apply(ctx) {
  const toasts = new ToastStore();
  const dictionaries = { en: EN, zh: ZH };

  ctx.effect(() => ctx.locale.register(LOCALE_NS, dictionaries), 'scale-commander: dictionaries');
  const t = ctx.locale.bind(LOCALE_NS);

  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.scaleCommander = '';
    style.textContent = CSS;
    document.head.append(style);
    return () => style.remove();
  }, 'scale-commander: styles');

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: LOCALE_NS,
    inject: () => ({ toasts }),
  }, ScaleCommanderPage));

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 20,
    locale: LOCALE_NS,
    label: () => t('panel'),
  }, ScaleCommanderIcon));
}
