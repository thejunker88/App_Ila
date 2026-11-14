import { describe, expect, it } from 'vitest';
import { formatDate, parseDate } from './dates';

describe('date GG/MM/AAAA', () => {
  it.each([
    ['2026-11-14', '14/11/2026'],
    ['2026-02-01', '01/02/2026'],
    ['2024-02-29', '29/02/2024'],
    ['2026-12-31', '31/12/2026'],
  ])('converte %s in %s e ripristina la data interna senza scambiare giorno e mese', (iso, displayed) => {
    expect(formatDate(iso)).toBe(displayed);
    expect(parseDate(displayed)).toBe(iso);
  });

  it.each(['29/02/2025', '31/04/2026', '00/12/2026', '14/13/2026', '1/2/2026', '2026-11-14', '11/14/2026', ''])(
    'rifiuta date impossibili o in formato diverso: %s',
    value => { expect(() => parseDate(value)).toThrow('GG/MM/AAAA'); },
  );
});
