import Dexie, { type Table } from 'dexie';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Backup {
  app: 'app-ila';
  version: 1;
  exportedAt: string;
  notes: Note[];
}

export class AppDatabase extends Dexie {
  notes!: Table<Note, string>;

  constructor(name = 'app-ila') {
    super(name);
    this.version(1).stores({ notes: 'id, updatedAt' });
  }
}

export const db = new AppDatabase();

export async function addNote(title: string, content: string, database = db): Promise<void> {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length > 120 || content.length > 10000) {
    throw new Error('Titolo obbligatorio (massimo 120 caratteri), testo massimo 10000 caratteri.');
  }
  const now = new Date().toISOString();
  await database.notes.add({
    id: crypto.randomUUID(),
    title: cleanTitle,
    content,
    createdAt: now,
    updatedAt: now,
  });
}

export async function createBackup(database = db): Promise<Backup> {
  return {
    app: 'app-ila',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: await database.notes.toArray(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

export function parseBackup(text: string): Backup {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.app !== 'app-ila' || value.version !== 1 ||
    !isTimestamp(value.exportedAt) || !Array.isArray(value.notes)) {
    throw new Error('Backup non valido o versione non supportata.');
  }

  const ids = new Set<string>();
  const notes: Note[] = value.notes.map((note: unknown) => {
    if (!isRecord(note) ||
      typeof note.id !== 'string' || !/^[\w-]{1,100}$/.test(note.id) ||
      typeof note.title !== 'string' || !note.title.trim() || note.title.length > 120 ||
      typeof note.content !== 'string' || note.content.length > 10000 ||
      !isTimestamp(note.createdAt) || !isTimestamp(note.updatedAt) ||
      note.updatedAt < note.createdAt || ids.has(note.id)) {
      throw new Error('Il backup contiene note non valide o identificativi duplicati.');
    }
    ids.add(note.id);
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    };
  });
  return { app: 'app-ila', version: 1, exportedAt: value.exportedAt, notes };
}

export async function restoreBackup(text: string, database = db): Promise<void> {
  const backup = parseBackup(text);
  // Clear and insert together: a failed import must preserve the previous data.
  await database.transaction('rw', database.notes, async () => {
    await database.notes.clear();
    await database.notes.bulkAdd(backup.notes);
  });
}
