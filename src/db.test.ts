import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { formatDate } from './dates';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addClinic,
  addTariffPeriod,
  addWorkEntry,
  archiveClinic,
  AppDatabase,
  calculateAmountCents,
  createBackup,
  currentMonth,
  formatHours,
  getMonthlySummary,
  getTariffForDate,
  parseBackup,
  parseHours,
  parseHourlyRate,
  restoreBackup,
  todayDate,
  updateTariffPeriod,
  updateWorkEntry,
  type TariffPeriod,
} from './db';

let database: AppDatabase;
beforeEach(() => { database = new AppDatabase(`test-${crypto.randomUUID()}`); });
afterEach(async () => { await database.delete(); });

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

describe('migratione locale e backup', () => {
  it('migra il database della versione precedente conservando le note esistenti', async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({ notes: 'id, updatedAt' });
    await legacy.table('notes').add({
      id: 'legacy-note',
      title: 'Nota precedente',
      content: 'Da conservare',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    legacy.close();

    const migrated = new AppDatabase(name);
    await migrated.open();
    expect(await migrated.notes.get('legacy-note')).toMatchObject({ title: 'Nota precedente' });
    expect(await migrated.clinics.count()).toBe(0);
    await migrated.delete();
  });

  it('esporta e ripristina dati operativi; un backup non valido non modifica nulla', async () => {
    const clinic = await addClinic('Studio Centro', 'Nota privata', database);
    const tariff = await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2020-01-01',
      validTo: null,
      hourlyRateCents: 3250,
    }, database);
    await addWorkEntry({
      clinicId: clinic.id,
      date: daysAgo(1),
      hours: 5,
      notes: 'Visite',
    }, database);
    const backupText = JSON.stringify(await createBackup(database));
    const parsed = parseBackup(backupText);
    expect(parsed.version).toBe(2);
    expect(parsed.clinics).toHaveLength(1);
    expect(parsed.tariffPeriods[0]?.id).toBe(tariff.id);
    expect(parsed.workEntries[0]).toMatchObject({ hours: 5, hourlyRateCents: 3250, amountCents: 16250 });

    await database.workEntries.clear();
    await database.clinics.clear();
    await restoreBackup(backupText, database);
    expect(await database.workEntries.count()).toBe(1);
    expect(await database.clinics.get(clinic.id)).toMatchObject({ name: 'Studio Centro' });

    await expect(restoreBackup(JSON.stringify({ ...parsed, workEntries: [{ ...parsed.workEntries[0], amountCents: 1 }] }), database))
      .rejects.toThrow();
    expect(await database.workEntries.count()).toBe(1);
  });

  it('accetta i backup v1 di sole note e rifiuta JSON o identificativi duplicati', async () => {
    const note = {
      id: 'old-note',
      title: 'Nota precedente',
      content: 'Da conservare',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const legacy = parseBackup(JSON.stringify({
      app: 'app-ila',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      notes: [note],
    }));
    expect(legacy.version).toBe(2);
    expect(legacy.notes).toEqual([note]);
    expect(legacy.workEntries).toEqual([]);
    await expect(restoreBackup('{', database)).rejects.toThrow();
    await expect(restoreBackup(JSON.stringify({
      app: 'app-ila',
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      notes: [note, note],
      clinics: [],
      tariffPeriods: [],
      workEntries: [],
    }), database)).rejects.toThrow('duplicati');
  });
});

describe('studi e periodi tariffari', () => {
  it('converte tariffe in centesimi e rispetta gli estremi inclusivi senza sovrapposizioni', async () => {
    expect(parseHourlyRate('30')).toBe(3000);
    expect(parseHourlyRate('32,50')).toBe(3250);
    expect(() => parseHourlyRate('0')).toThrow();
    expect(() => parseHourlyRate('30.999')).toThrow();
    expect(() => parseHourlyRate('1,000')).toThrow();

    const clinic = await addClinic('Studio Centro', '', database);
    await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2025-01-01',
      validTo: '2025-01-31',
      hourlyRateCents: 3000,
    }, database);
    const february: TariffPeriod = await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2025-02-01',
      validTo: null,
      hourlyRateCents: 3500,
    }, database);
    await expect(addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2025-01-31',
      validTo: '2025-02-01',
      hourlyRateCents: 4000,
    }, database)).rejects.toThrow('sovrappone');
    expect((await getTariffForDate(clinic.id, '2025-01-31', database))?.hourlyRateCents).toBe(3000);
    expect((await getTariffForDate(clinic.id, '2025-02-01', database))?.id).toBe(february.id);
    expect(await getTariffForDate(clinic.id, '2024-12-31', database)).toBeUndefined();
  });

  it('archivia gli studi senza cancellare i compensi storici', async () => {
    const clinic = await addClinic('Studio Centro', '', database);
    await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2020-01-01',
      validTo: null,
      hourlyRateCents: 3000,
    }, database);
    const entry = await addWorkEntry({
      clinicId: clinic.id,
      date: daysAgo(1),
      hours: 4,
      notes: '',
    }, database);
    await archiveClinic(clinic.id, database);
    expect(await database.workEntries.get(entry.id)).toMatchObject({ amountCents: 12000 });
    await expect(addWorkEntry({
      clinicId: clinic.id,
      date: todayDate(),
      hours: 1,
      notes: '',
    }, database)).rejects.toThrow('attivo');
  });

  it('non inventa un limite massimo di ore e non salva compensi senza tariffa', async () => {
    const clinic = await addClinic('Studio Centro', '', database);
    await expect(addWorkEntry({
      clinicId: clinic.id,
      date: todayDate(),
      hours: 1,
      notes: '',
    }, database)).rejects.toThrow('Nessuna tariffa');
    await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2020-01-01',
      validTo: null,
      hourlyRateCents: 3000,
    }, database);
    const entry = await addWorkEntry({
      clinicId: clinic.id,
      date: todayDate(),
      hours: 25,
      notes: '',
    }, database);
    expect(entry).toMatchObject({ hours: 25, amountCents: 75000 });
  });
});

describe('registrazioni e compensi', () => {
  it('accetta mezze ore, mostra la virgola italiana e arrotonda il compenso della registrazione al centesimo', async () => {
    expect(parseHours('3,5')).toBe(3.5);
    expect(parseHours('3.5')).toBe(3.5);
    expect(parseHours('0,5')).toBe(0.5);
    expect(parseHours('3,0')).toBe(3);
    expect(formatHours(3.5)).toBe('3,5');
    expect(formatHours(3)).toBe('3');
    expect(calculateAmountCents(0.5, 3001)).toBe(1501);
    expect(calculateAmountCents(3.5, 3001)).toBe(10504);
    for (const invalid of ['', '0', '0,25', '3,25', '3,75', '-0,5', '3,5 ore']) {
      expect(() => parseHours(invalid)).toThrow();
    }

    const clinic = await addClinic('Studio Mezzore', '', database);
    await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2020-01-01',
      validTo: null,
      hourlyRateCents: 3001,
    }, database);
    const entry = await addWorkEntry({
      clinicId: clinic.id,
      date: todayDate(),
      hours: parseHours('3,5'),
      notes: '',
    }, database);
    expect(entry).toMatchObject({ hours: 3.5, amountCents: 10504 });
    await expect(addWorkEntry({
      clinicId: clinic.id,
      date: todayDate(),
      hours: 3.25,
      notes: '',
    }, database)).rejects.toThrow('mezz’ora');
  });

  it('applica la tariffa in base alla data, salva lo snapshot e aggiorna il totale mensile', async () => {
    const clinicA = await addClinic('Studio A', '', database);
    const clinicB = await addClinic('Studio B', '', database);
    await addTariffPeriod({ clinicId: clinicA.id, validFrom: '2020-01-01', validTo: null, hourlyRateCents: 3000 }, database);
    await addTariffPeriod({ clinicId: clinicB.id, validFrom: '2020-01-01', validTo: null, hourlyRateCents: 3500 }, database);
    const today = todayDate();
    const first = await addWorkEntry({ clinicId: clinicA.id, date: today, hours: 6, notes: '' }, database);
    await addWorkEntry({ clinicId: clinicB.id, date: today, hours: 4, notes: '' }, database);
    expect(first.amountCents).toBe(18000);
    await expect(addWorkEntry({ clinicId: clinicA.id, date: today, hours: 1, notes: '' }, database))
      .rejects.toThrow('già una registrazione');
    await expect(addWorkEntry({
      clinicId: clinicA.id,
      date: '2999-01-01',
      hours: 1,
      notes: '',
    }, database)).rejects.toThrow('non può essere futura');

    const summary = await getMonthlySummary(currentMonth(), database);
    expect(summary.totalHours).toBe(10);
    expect(summary.totalCents).toBe(32000);
    expect(summary.byClinic).toHaveLength(2);
  });

  it('conserva la tariffa storica per impostazione predefinita e ricalcola solo su richiesta', async () => {
    const clinic = await addClinic('Studio Centro', '', database);
    const tariff = await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2020-01-01',
      validTo: null,
      hourlyRateCents: 3000,
    }, database);
    const entry = await addWorkEntry({
      clinicId: clinic.id,
      date: daysAgo(1),
      hours: 5,
      notes: '',
    }, database);
    const changedTariff = { ...tariff, hourlyRateCents: 4000 };
    await updateTariffPeriod(tariff.id, changedTariff, false, database);
    expect(await database.workEntries.get(entry.id)).toMatchObject({ hourlyRateCents: 3000, amountCents: 15000 });

    await updateWorkEntry(entry.id, { clinicId: clinic.id, date: entry.date, hours: 3.5, notes: 'Corretto' }, database);
    expect(await database.workEntries.get(entry.id)).toMatchObject({ hours: 3.5, hourlyRateCents: 3000, amountCents: 10500 });

    await updateTariffPeriod(tariff.id, changedTariff, true, database);
    expect(await database.workEntries.get(entry.id)).toMatchObject({ hours: 3.5, hourlyRateCents: 4000, amountCents: 14000 });
  });

  it('annulla il ricalcolo se la modifica lascia una registrazione senza tariffa', async () => {
    const clinic = await addClinic('Studio Centro', '', database);
    const oldEnd = daysAgo(2);
    const tariff = await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2020-01-01',
      validTo: oldEnd,
      hourlyRateCents: 3000,
    }, database);
    await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: daysAgo(1),
      validTo: null,
      hourlyRateCents: 3500,
    }, database);
    const entry = await addWorkEntry({
      clinicId: clinic.id,
      date: oldEnd,
      hours: 2,
      notes: '',
    }, database);
    await expect(updateTariffPeriod(tariff.id, {
      ...tariff,
      validTo: daysAgo(3),
      hourlyRateCents: 4000,
    }, true, database)).rejects.toThrow(`Non esiste una tariffa per il ${formatDate(oldEnd)}.`);
    expect(await database.tariffPeriods.get(tariff.id)).toMatchObject({ validTo: oldEnd, hourlyRateCents: 3000 });
    expect(await database.workEntries.get(entry.id)).toMatchObject({ hourlyRateCents: 3000, amountCents: 6000 });
  });

  it('usa la nuova tariffa se si modifica la data della registrazione e non duplica il giorno', async () => {
    const clinic = await addClinic('Studio Centro', '', database);
    await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: '2020-01-01',
      validTo: daysAgo(2),
      hourlyRateCents: 3000,
    }, database);
    await addTariffPeriod({
      clinicId: clinic.id,
      validFrom: daysAgo(1),
      validTo: null,
      hourlyRateCents: 3500,
    }, database);
    const entry = await addWorkEntry({
      clinicId: clinic.id,
      date: daysAgo(2),
      hours: 3,
      notes: '',
    }, database);
    const duplicate = await addWorkEntry({
      clinicId: clinic.id,
      date: daysAgo(1),
      hours: 2,
      notes: '',
    }, database);
    await expect(updateWorkEntry(
      entry.id,
      { clinicId: clinic.id, date: daysAgo(1), hours: 3, notes: '' },
      database,
    )).rejects.toThrow('già una registrazione');
    expect(await database.workEntries.get(entry.id)).toMatchObject({ date: daysAgo(2), amountCents: 9000 });
    await database.workEntries.delete(duplicate.id);
    await updateWorkEntry(entry.id, { clinicId: clinic.id, date: daysAgo(1), hours: 3, notes: '' }, database);
    await expect(database.workEntries.get(entry.id)).resolves.toMatchObject({
      date: daysAgo(1),
      amountCents: 10500,
      hourlyRateCents: 3500,
    });
    await expect(database.workEntries.get(duplicate.id)).resolves.toBeUndefined();
  });
});
