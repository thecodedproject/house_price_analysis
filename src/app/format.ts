import { Property } from '../shared/types';

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

export function formatPrice(n: number | undefined): string {
  return n === undefined ? '' : gbp.format(n);
}

export function formatAddress(p: Pick<Property, 'saon' | 'paon' | 'street'>): string {
  const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return [p.saon, `${p.paon} ${p.street}`].filter(Boolean).map((s) => titleCase(s!)).join(', ');
}
