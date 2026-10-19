/**
 * Display strings for the panel entry and the settings surface.
 *
 * The plugin's own views are written in English; this dictionary covers the
 * strings the Harness shell projects (the panel label) and the strings a
 * Chinese user sees first. Adding a locale is one more object here.
 * @module client/locale
 */

/** The panel id, shared with the sidebar entry. */
export const PANEL_ID = 'scale-commander';
/** The locale namespace the page registers. */
export const LOCALE_NS = 'scale-commander';

export const EN = {
  panel: 'Scale Commander',
  panelHint: 'Amazon PPC automation',
};

export const ZH = {
  panel: 'Scale Commander',
  panelHint: '亚马逊 PPC 自动化',
};
