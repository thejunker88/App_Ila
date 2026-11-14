import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addNote, AppDatabase, createBackup, parseBackup, restoreBackup } from './db';

let database: AppDatabase;
beforeEach(() => { database = new AppDatabase(`test-${crypto.randomUUID()}`); });
afterEach(async () => { await database.delete(); });

describe('database locale e backup', () => {
  it('conserva le note dopo la riapertura e ripristina un backup senza perdere testo', async () => {
    await addNote('  Prima nota  ', '<script>test</script>\nSeconda riga', database);
    const backup = JSON.stringify(await createBackup(database));
    database.close();
    await database.open();
    expect((await database.notes.toArray())[0]?.title).toBe('Prima nota');
    await addNote('Da sostituire', '', database);
    await restoreBackup(backup, database);
    expect(await database.notes.toArray()).toEqual(parseBackup(backup).notes);
  });

  it('rifiuta backup incompatibili o duplicati senza modificare i dati', async () => {
    await addNote('Originale', 'Non cancellare', database);
    const original = await createBackup(database);
    for (const backup of [
      { ...original, version: 2 },
      { ...original, notes: [original.notes[0], original.notes[0]] },
      { ...original, notes: [{ ...original.notes[0], updatedAt: '2026-02-30T00:00:00.000Z' }] },
      { ...original, notes: [{ ...original.notes[0], title: '   ' }] },
    ]) {
      await expect(restoreBackup(JSON.stringify(backup), database)).rejects.toThrow();
      expect(await database.notes.toArray()).toEqual(original.notes);
    }
    await expect(restoreBackup('{', database)).rejects.toThrow();
    expect(await database.notes.toArray()).toEqual(original.notes);
  });

  it('annulla anche la cancellazione se la scrittura del backup fallisce', async () => {
    await addNote('Originale', '', database);
    const original = await createBackup(database);
    const backup = { ...original, notes: [{ ...original.notes[0], id: 'failing-note' }] };
    database.notes.hook('creating', (_key, note) => {
      if (note.id === 'failing-note') throw new Error('Errore di scrittura simulato');
    });
    await expect(restoreBackup(JSON.stringify(backup), database)).rejects.toThrow('Errore di scrittura');
    expect(await database.notes.toArray()).toEqual(original.notes);
  });

  it('accetta backup vuoti e rifiuta note fuori limite', async () => {
    await addNote('Originale', '', database);
    const backup = await createBackup(database);
    await restoreBackup(JSON.stringify({ ...backup, notes: [] }), database);
    expect(await database.notes.count()).toBe(0);
    await expect(addNote(' ', '', database)).rejects.toThrow();
    await expect(addNote('a'.repeat(121), '', database)).rejects.toThrow();
    await expect(addNote('Titolo', 'a'.repeat(10001), database)).rejects.toThrow();
  });
});
