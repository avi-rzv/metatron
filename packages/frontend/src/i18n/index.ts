import { enUS } from './en-US';

// Direction for RTL languages
export type Dir = 'ltr' | 'rtl';

const locales = {
  'en-US': { strings: enUS, dir: 'ltr' as Dir },
} as const;

export type Locale = keyof typeof locales;

// Active locale — extend here when adding more languages
const ACTIVE_LOCALE: Locale = 'en-US';

export const t = locales[ACTIVE_LOCALE].strings;
export const dir: Dir = locales[ACTIVE_LOCALE].dir;
export const locale: Locale = ACTIVE_LOCALE;
