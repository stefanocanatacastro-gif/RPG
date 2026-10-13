// Minimal EN/ES lookup for M0. The full Strings manager (variables, runtime
// language switch, missing-key warnings) is an M2 task.

import en from '../strings/en.json';
import es from '../strings/es.json';

type Table = Record<string, string>;
const TABLES: Record<string, Table> = { en, es };

let lang: 'en' | 'es' = navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';

export function setLanguage(l: 'en' | 'es'): void {
  lang = l;
}

export function language(): 'en' | 'es' {
  return lang;
}

export function t(key: string): string {
  return TABLES[lang][key] ?? TABLES.en[key] ?? key;
}

export function englishKeys(): Set<string> {
  return new Set(Object.keys(TABLES.en));
}

/** Text with {name}-style variables filled in. */
export function tf(key: string, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Adds or replaces text at runtime (custom fighters bring their own names). */
export function addStrings(table: Record<string, string>, l: 'en' | 'es' = 'en'): void {
  Object.assign(TABLES[l], table);
}

/** Text that's either a string-table key or written in place ({ en, es }). */
export function tx(v: string | { en: string; es?: string }): string {
  if (typeof v === 'string') return t(v);
  return (lang === 'es' && v.es) || v.en;
}
