export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function formatDate(value: string): string {
  if (!isDate(value)) throw new Error('Data non valida.');
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

export function parseDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (match) {
    const isoDate = `${match[3]}-${match[2]}-${match[1]}`;
    if (isDate(isoDate)) return isoDate;
  }
  throw new Error('Inserisci una data valida nel formato GG/MM/AAAA.');
}
