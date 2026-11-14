import Dexie, { type Table } from 'dexie';
import { formatDate, isDate } from './dates';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Clinic {
  id: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface TariffPeriod {
  id: string;
  clinicId: string;
  validFrom: string;
  validTo: string | null;
  hourlyRateCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkEntry {
  id: string;
  clinicId: string;
  tariffPeriodId: string;
  date: string;
  hours: number;
  notes: string;
  hourlyRateCents: number;
  amountCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface Backup {
  app: 'app-ila';
  version: 2;
  exportedAt: string;
  notes: Note[];
  clinics: Clinic[];
  tariffPeriods: TariffPeriod[];
  workEntries: WorkEntry[];
}

export interface WorkEntryInput {
  clinicId: string;
  date: string;
  hours: number;
  notes: string;
}

export interface TariffPeriodInput {
  clinicId: string;
  validFrom: string;
  validTo: string | null;
  hourlyRateCents: number;
}

export class AppDatabase extends Dexie {
  notes!: Table<Note, string>;
  clinics!: Table<Clinic, string>;
  tariffPeriods!: Table<TariffPeriod, string>;
  workEntries!: Table<WorkEntry, string>;

  constructor(name = 'app-ila') {
    super(name);
    this.version(1).stores({ notes: 'id, updatedAt' });
    this.version(2).stores({
      notes: 'id, updatedAt',
      clinics: 'id, name, updatedAt, archivedAt',
      tariffPeriods: 'id, clinicId, validFrom, [clinicId+validFrom]',
      workEntries: 'id, date, clinicId, tariffPeriodId, [clinicId+date], [date+clinicId]',
    });
  }
}

export const db = new AppDatabase();

const MAX_NAME_LENGTH = 120;
const MAX_NOTES_LENGTH = 10000;
const DAY_END = '9999-12-31';

export function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function currentMonth(): string {
  return todayDate().slice(0, 7);
}

export function parseHourlyRate(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Inserisci una tariffa positiva con al massimo due decimali.');
  }
  const [whole = '', fractional = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error('La tariffa deve essere un importo positivo valido.');
  }
  return cents;
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function validateNameAndNotes(name: string, notes: string): { name: string; notes: string } {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > MAX_NAME_LENGTH || notes.length > MAX_NOTES_LENGTH) {
    throw new Error('Il nome è obbligatorio (massimo 120 caratteri); le note non possono superare 10000 caratteri.');
  }
  return { name: cleanName, notes };
}

function validateTariffInput(input: TariffPeriodInput): void {
  if (!isId(input.clinicId) || !isDate(input.validFrom) ||
    (input.validTo !== null && !isDate(input.validTo)) ||
    (input.validTo !== null && input.validTo < input.validFrom) ||
    !Number.isSafeInteger(input.hourlyRateCents) || input.hourlyRateCents <= 0) {
    throw new Error('Periodo tariffario o tariffa non validi.');
  }
}

function overlaps(left: TariffPeriodInput, right: TariffPeriodInput): boolean {
  return left.validFrom <= (right.validTo ?? DAY_END) &&
    right.validFrom <= (left.validTo ?? DAY_END);
}

function findTariff(periods: TariffPeriod[], clinicId: string, date: string): TariffPeriod | undefined {
  return periods.find(period =>
    period.clinicId === clinicId &&
    period.validFrom <= date &&
    (period.validTo === null || date <= period.validTo),
  );
}

function validateWorkInput(input: WorkEntryInput): void {
  if (!isId(input.clinicId) || !isDate(input.date) || input.date > todayDate() ||
    !Number.isSafeInteger(input.hours) || input.hours < 1 ||
    typeof input.notes !== 'string' || input.notes.length > MAX_NOTES_LENGTH) {
    throw new Error('Data, ore o note non valide. Le ore devono essere un intero positivo e la data non futura.');
  }
}

export async function addClinic(name: string, notes = '', database = db): Promise<Clinic> {
  const values = validateNameAndNotes(name, notes);
  const now = new Date().toISOString();
  const clinic: Clinic = { id: crypto.randomUUID(), ...values, createdAt: now, updatedAt: now };
  await database.clinics.add(clinic);
  return clinic;
}

export async function updateClinic(
  id: string,
  name: string,
  notes: string,
  database = db,
): Promise<void> {
  const values = validateNameAndNotes(name, notes);
  const clinic = await database.clinics.get(id);
  if (!clinic) throw new Error('Studio non trovato.');
  await database.clinics.update(id, { ...values, updatedAt: new Date().toISOString() });
}

export async function archiveClinic(id: string, database = db): Promise<void> {
  await database.transaction('rw', database.clinics, async () => {
    const clinic = await database.clinics.get(id);
    if (!clinic) throw new Error('Studio non trovato.');
    if (clinic.archivedAt) return;
    const now = new Date().toISOString();
    await database.clinics.update(id, { archivedAt: now, updatedAt: now });
  });
}

export async function addTariffPeriod(
  input: TariffPeriodInput,
  database = db,
): Promise<TariffPeriod> {
  validateTariffInput(input);
  return database.transaction('rw', database.clinics, database.tariffPeriods, async () => {
    const clinic = await database.clinics.get(input.clinicId);
    if (!clinic || clinic.archivedAt) throw new Error('Seleziona uno studio attivo.');
    const periods = await database.tariffPeriods.where('clinicId').equals(input.clinicId).toArray();
    if (periods.some(period => overlaps(input, period))) {
      throw new Error('Il periodo tariffario si sovrappone a un altro periodo dello studio.');
    }
    const now = new Date().toISOString();
    const tariff: TariffPeriod = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
    await database.tariffPeriods.add(tariff);
    return tariff;
  });
}

export async function updateTariffPeriod(
  id: string,
  input: TariffPeriodInput,
  recalculateHistorical: boolean,
  database = db,
): Promise<void> {
  validateTariffInput(input);
  await database.transaction('rw', database.clinics, database.tariffPeriods, database.workEntries, async () => {
    const previous = await database.tariffPeriods.get(id);
    if (!previous) throw new Error('Periodo tariffario non trovato.');
    if (previous.clinicId !== input.clinicId) {
      throw new Error('Non è possibile spostare un periodo tariffario a un altro studio.');
    }
    const otherPeriods = await database.tariffPeriods.where('clinicId').equals(input.clinicId).toArray();
    if (otherPeriods.some(period => period.id !== id && overlaps(input, period))) {
      throw new Error('Il periodo tariffario si sovrappone a un altro periodo dello studio.');
    }

    const updated: TariffPeriod = {
      ...previous,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    const start = previous.validFrom < input.validFrom ? previous.validFrom : input.validFrom;
    const end = previous.validTo === null || input.validTo === null
      ? null
      : previous.validTo > input.validTo ? previous.validTo : input.validTo;
    const affectedEntries = (await database.workEntries.where('clinicId').equals(input.clinicId).toArray())
      .filter(entry => entry.date >= start && (end === null || entry.date <= end));

    await database.tariffPeriods.put(updated);
    if (recalculateHistorical) {
      const periods = otherPeriods.map(period => period.id === id ? updated : period);
      for (const entry of affectedEntries) {
        const tariff = findTariff(periods, entry.clinicId, entry.date);
        if (!tariff) {
          throw new Error(`Non esiste una tariffa per il ${formatDate(entry.date)}. Correggi i periodi prima di ricalcolare.`);
        }
        if (!Number.isSafeInteger(entry.hours * tariff.hourlyRateCents)) {
          throw new Error('Il compenso supera il limite numerico supportato.');
        }
        await database.workEntries.update(entry.id, {
          tariffPeriodId: tariff.id,
          hourlyRateCents: tariff.hourlyRateCents,
          amountCents: entry.hours * tariff.hourlyRateCents,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  });
}

export async function deleteTariffPeriod(id: string, database = db): Promise<void> {
  await database.transaction('rw', database.workEntries, database.tariffPeriods, async () => {
    const usages = await database.workEntries.where('tariffPeriodId').equals(id).count();
    if (usages > 0) {
      throw new Error('Questo periodo è usato da registrazioni storiche e non può essere eliminato. Puoi modificarlo.');
    }
    await database.tariffPeriods.delete(id);
  });
}

export async function getTariffForDate(
  clinicId: string,
  date: string,
  database = db,
): Promise<TariffPeriod | undefined> {
  const periods = await database.tariffPeriods.where('clinicId').equals(clinicId).toArray();
  return findTariff(periods, clinicId, date);
}

export async function addWorkEntry(input: WorkEntryInput, database = db): Promise<WorkEntry> {
  validateWorkInput(input);
  return database.transaction('rw', database.clinics, database.tariffPeriods, database.workEntries, async () => {
    const clinic = await database.clinics.get(input.clinicId);
    if (!clinic || clinic.archivedAt) throw new Error('Seleziona uno studio attivo.');
    const duplicate = await database.workEntries
      .where('[clinicId+date]').equals([input.clinicId, input.date]).first();
    if (duplicate) throw new Error('Esiste già una registrazione per questo studio e questa data.');
    const periods = await database.tariffPeriods.where('clinicId').equals(input.clinicId).toArray();
    const tariff = findTariff(periods, input.clinicId, input.date);
    if (!tariff) throw new Error('Nessuna tariffa configurata per questo studio e questa data.');
    if (!Number.isSafeInteger(input.hours * tariff.hourlyRateCents)) {
      throw new Error('Il compenso supera il limite numerico supportato.');
    }
    const now = new Date().toISOString();
    const entry: WorkEntry = {
      id: crypto.randomUUID(),
      ...input,
      tariffPeriodId: tariff.id,
      hourlyRateCents: tariff.hourlyRateCents,
      amountCents: input.hours * tariff.hourlyRateCents,
      createdAt: now,
      updatedAt: now,
    };
    await database.workEntries.add(entry);
    return entry;
  });
}

export async function updateWorkEntry(
  id: string,
  input: WorkEntryInput,
  database = db,
): Promise<void> {
  validateWorkInput(input);
  await database.transaction('rw', database.clinics, database.tariffPeriods, database.workEntries, async () => {
    const previous = await database.workEntries.get(id);
    if (!previous) throw new Error('Registrazione non trovata.');
    const clinic = await database.clinics.get(input.clinicId);
    if (!clinic || (clinic.archivedAt && input.clinicId !== previous.clinicId)) {
      throw new Error('Seleziona uno studio attivo.');
    }
    const duplicate = await database.workEntries
      .where('[clinicId+date]').equals([input.clinicId, input.date])
      .filter(entry => entry.id !== id)
      .first();
    if (duplicate) throw new Error('Esiste già una registrazione per questo studio e questa data.');

    const unchangedSelection = input.clinicId === previous.clinicId && input.date === previous.date;
    const tariff = unchangedSelection
      ? undefined
      : findTariff(
          await database.tariffPeriods.where('clinicId').equals(input.clinicId).toArray(),
          input.clinicId,
          input.date,
        );
    if (!unchangedSelection && !tariff) {
      throw new Error('Nessuna tariffa configurata per il nuovo studio e la nuova data.');
    }
    const hourlyRateCents = tariff?.hourlyRateCents ?? previous.hourlyRateCents;
    if (!Number.isSafeInteger(input.hours * hourlyRateCents)) {
      throw new Error('Il compenso supera il limite numerico supportato.');
    }
    await database.workEntries.put({
      ...previous,
      ...input,
      tariffPeriodId: tariff?.id ?? previous.tariffPeriodId,
      hourlyRateCents,
      amountCents: input.hours * hourlyRateCents,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function deleteWorkEntry(id: string, database = db): Promise<void> {
  await database.workEntries.delete(id);
}

export async function getMonthlySummary(month: string, database = db): Promise<{
  totalHours: number;
  totalCents: number;
  byClinic: Array<{ clinicId: string; clinicName: string; hours: number; cents: number }>;
  entries: WorkEntry[];
}> {
  if (!/^\d{4}-\d{2}$/.test(month) || !isDate(`${month}-01`) || month > currentMonth()) {
    throw new Error('Seleziona un mese valido non successivo a quello corrente.');
  }
  const start = `${month}-01`;
  const end = month === currentMonth()
    ? todayDate()
    : `${month}-${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()}`;
  const entries = await database.workEntries.where('date').between(start, end, true, true).toArray();
  const clinics = await database.clinics.toArray();
  const grouped = new Map<string, { clinicId: string; clinicName: string; hours: number; cents: number }>();
  for (const entry of entries) {
    const group = grouped.get(entry.clinicId) ?? {
      clinicId: entry.clinicId,
      clinicName: clinics.find(clinic => clinic.id === entry.clinicId)?.name ?? 'Studio archiviato',
      hours: 0,
      cents: 0,
    };
    group.hours += entry.hours;
    group.cents += entry.amountCents;
    grouped.set(entry.clinicId, group);
  }
  return {
    totalHours: entries.reduce((sum, entry) => sum + entry.hours, 0),
    totalCents: entries.reduce((sum, entry) => sum + entry.amountCents, 0),
    byClinic: [...grouped.values()].sort((left, right) => left.clinicName.localeCompare(right.clinicName, 'it')),
    entries: entries.sort((left, right) => right.date.localeCompare(left.date)),
  };
}

export async function createBackup(database = db): Promise<Backup> {
  return {
    app: 'app-ila',
    version: 2,
    exportedAt: new Date().toISOString(),
    notes: await database.notes.toArray(),
    clinics: await database.clinics.toArray(),
    tariffPeriods: await database.tariffPeriods.toArray(),
    workEntries: await database.workEntries.toArray(),
  };
}

function parseNote(value: unknown): Note {
  if (!isRecord(value) ||
    !isId(value.id) ||
    typeof value.title !== 'string' || !value.title.trim() || value.title.length > MAX_NAME_LENGTH ||
    typeof value.content !== 'string' || value.content.length > MAX_NOTES_LENGTH ||
    !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || value.updatedAt < value.createdAt) {
    throw new Error('Il backup contiene note non valide.');
  }
  return {
    id: value.id,
    title: value.title,
    content: value.content,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseClinic(value: unknown): Clinic {
  if (!isRecord(value) ||
    !isId(value.id) ||
    typeof value.name !== 'string' || !value.name.trim() || value.name.length > MAX_NAME_LENGTH ||
    typeof value.notes !== 'string' || value.notes.length > MAX_NOTES_LENGTH ||
    !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) ||
    (value.archivedAt !== undefined && !isTimestamp(value.archivedAt))) {
    throw new Error('Il backup contiene studi non validi.');
  }
  return {
    id: value.id,
    name: value.name,
    notes: value.notes,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.archivedAt === undefined ? {} : { archivedAt: value.archivedAt as string }),
  };
}

function parseTariff(value: unknown): TariffPeriod {
  if (!isRecord(value) ||
    !isId(value.id) || !isId(value.clinicId) ||
    !isDate(value.validFrom) || (value.validTo !== null && !isDate(value.validTo)) ||
    (value.validTo !== null && (value.validTo as string) < value.validFrom) ||
    !Number.isSafeInteger(value.hourlyRateCents) || (value.hourlyRateCents as number) <= 0 ||
    !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
    throw new Error('Il backup contiene periodi tariffari non validi.');
  }
  return {
    id: value.id,
    clinicId: value.clinicId,
    validFrom: value.validFrom,
    validTo: value.validTo as string | null,
    hourlyRateCents: value.hourlyRateCents as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseWorkEntry(value: unknown): WorkEntry {
  if (!isRecord(value) ||
    !isId(value.id) || !isId(value.clinicId) || !isId(value.tariffPeriodId) ||
    !isDate(value.date) || value.date > todayDate() ||
    !Number.isSafeInteger(value.hours) || (value.hours as number) < 1 ||
    typeof value.notes !== 'string' || value.notes.length > MAX_NOTES_LENGTH ||
    !Number.isSafeInteger(value.hourlyRateCents) || (value.hourlyRateCents as number) <= 0 ||
    !Number.isSafeInteger(value.amountCents) ||
    !Number.isSafeInteger((value.hours as number) * (value.hourlyRateCents as number)) ||
    value.amountCents !== (value.hours as number) * (value.hourlyRateCents as number) ||
    !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
    throw new Error('Il backup contiene registrazioni non valide.');
  }
  return {
    id: value.id,
    clinicId: value.clinicId,
    tariffPeriodId: value.tariffPeriodId,
    date: value.date,
    hours: value.hours as number,
    notes: value.notes,
    hourlyRateCents: value.hourlyRateCents as number,
    amountCents: value.amountCents as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseBackup(text: string): Backup {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.app !== 'app-ila' ||
    (value.version !== 1 && value.version !== 2) ||
    !isTimestamp(value.exportedAt) || !Array.isArray(value.notes)) {
    throw new Error('Backup non valido o versione non supportata.');
  }
  const notes = value.notes.map(parseNote);
  if (new Set(notes.map(note => note.id)).size !== notes.length) {
    throw new Error('Il backup contiene identificativi di nota duplicati.');
  }
  if (value.version === 1) {
    return { app: 'app-ila', version: 2, exportedAt: value.exportedAt, notes, clinics: [], tariffPeriods: [], workEntries: [] };
  }
  if (!Array.isArray(value.clinics) || !Array.isArray(value.tariffPeriods) || !Array.isArray(value.workEntries)) {
    throw new Error('Il backup non contiene tutti i dati degli studi.');
  }

  const clinics = value.clinics.map(parseClinic);
  const tariffPeriods = value.tariffPeriods.map(parseTariff);
  const workEntries = value.workEntries.map(parseWorkEntry);
  const clinicIds = new Set(clinics.map(clinic => clinic.id));
  const tariffIds = new Set(tariffPeriods.map(period => period.id));
  if (clinicIds.size !== clinics.length || tariffIds.size !== tariffPeriods.length ||
    new Set(workEntries.map(entry => entry.id)).size !== workEntries.length ||
    new Set(tariffPeriods.map(period => `${period.clinicId}:${period.validFrom}`)).size !== tariffPeriods.length ||
    new Set(workEntries.map(entry => `${entry.clinicId}:${entry.date}`)).size !== workEntries.length) {
    throw new Error('Il backup contiene identificativi o registrazioni duplicate.');
  }
  for (const period of tariffPeriods) {
    if (!clinicIds.has(period.clinicId)) throw new Error('Un periodo tariffario fa riferimento a uno studio mancante.');
  }
  for (const clinicId of clinicIds) {
    const periods = tariffPeriods.filter(period => period.clinicId === clinicId);
    if (periods.some((period, index) => periods.slice(index + 1).some(other => overlaps(period, other)))) {
      throw new Error('Il backup contiene periodi tariffari sovrapposti.');
    }
  }
  for (const entry of workEntries) {
    const period = tariffPeriods.find(candidate => candidate.id === entry.tariffPeriodId);
    if (!clinicIds.has(entry.clinicId) || !period || period.clinicId !== entry.clinicId) {
      throw new Error('Una registrazione fa riferimento a uno studio o periodo tariffario mancante.');
    }
  }
  return { app: 'app-ila', version: 2, exportedAt: value.exportedAt, notes, clinics, tariffPeriods, workEntries };
}

export async function restoreBackup(text: string, database = db): Promise<void> {
  const backup = parseBackup(text);
  await database.transaction(
    'rw',
    database.notes,
    database.clinics,
    database.tariffPeriods,
    database.workEntries,
    async () => {
      await Promise.all([
        database.notes.clear(),
        database.clinics.clear(),
        database.tariffPeriods.clear(),
        database.workEntries.clear(),
      ]);
      await Promise.all([
        database.notes.bulkAdd(backup.notes),
        database.clinics.bulkAdd(backup.clinics),
        database.tariffPeriods.bulkAdd(backup.tariffPeriods),
        database.workEntries.bulkAdd(backup.workEntries),
      ]);
    },
  );
}
