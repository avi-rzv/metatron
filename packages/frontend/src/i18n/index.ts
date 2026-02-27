import { enUS } from './en-US';
import { he } from './he';

// Direction for RTL languages
export type Dir = 'ltr' | 'rtl';

const locales = {
  'en-US': { strings: enUS, dir: 'ltr' as Dir, label: 'English' },
  'he': { strings: he, dir: 'rtl' as Dir, label: 'עברית' },
} as const;

export type Locale = keyof typeof locales;

// Available locales for the settings UI
export const availableLocales = Object.entries(locales).map(([id, { label }]) => ({
  id: id as Locale,
  label,
}));

// Read active locale from localStorage (default: en-US)
function getStoredLocale(): Locale {
  const stored = localStorage.getItem('locale');
  if (stored && stored in locales) return stored as Locale;
  return 'en-US';
}

const ACTIVE_LOCALE = getStoredLocale();

export const t = locales[ACTIVE_LOCALE].strings;
export const dir: Dir = locales[ACTIVE_LOCALE].dir;
export const locale: Locale = ACTIVE_LOCALE;

/** Save locale to localStorage and reload the page */
export function setLocale(newLocale: Locale) {
  if (newLocale === ACTIVE_LOCALE) return;
  localStorage.setItem('locale', newLocale);
  window.location.reload();
}
