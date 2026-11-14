import { registerSW } from 'virtual:pwa-register';
import { addNote, createBackup, db, parseBackup, restoreBackup } from './db';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Contenitore app mancante.');

app.innerHTML = `
  <header>
    <div><p class="eyebrow">SOLO SUL TUO DISPOSITIVO</p><h1>App Ila</h1></div>
    <span id="connection" class="badge"></span>
  </header>
  <main>
    <aside id="installation" class="card" hidden>
      <h2>Installazione su iPhone</h2>
      <p>Apri questo indirizzo in Safari, tocca Condividi e scegli
      <strong>Aggiungi alla schermata Home</strong>. Apri poi l'app dalla sua icona,
      prima di inserire dati: browser e app installata possono avere archivi separati.</p>
    </aside>
    <aside id="update" class="card" hidden aria-live="polite">
      <h2>Nuova versione disponibile</h2>
      <p>Le note salvate rimangono sul dispositivo. L'aggiornamento ricarica l'app.</p>
      <button id="update-button" type="button">Aggiorna ora</button>
    </aside>
    <p id="offline-ready" role="status" hidden>App pronta per funzionare offline.</p>
    <p id="error" role="alert" hidden></p>
    <p id="status" role="status"></p>
    <section class="card">
      <h2>Nuova nota</h2>
      <form id="note-form">
        <label for="title">Titolo</label>
        <input id="title" name="title" required maxlength="120" autocomplete="off" />
        <label for="content">Testo</label>
        <textarea id="content" name="content" rows="4" maxlength="10000"></textarea>
        <button type="submit">Salva sul dispositivo</button>
      </form>
    </section>
    <section class="card">
      <h2>Le tue note</h2>
      <p id="empty">Nessuna nota. Aggiungi la prima qui sopra.</p>
      <ul id="notes"></ul>
    </section>
    <section class="card">
      <h2>Backup e spazio locale</h2>
      <p>Non c'e sincronizzazione online. Esporta regolarmente un backup e conservalo
      in File o dove preferisci. La cancellazione dei dati del sito elimina le note.</p>
      <div class="actions">
        <button id="export" type="button">Esporta backup</button>
        <button id="import" type="button" class="secondary">Importa backup</button>
        <input id="backup-file" type="file" accept=".json,application/json" hidden />
      </div>
      <p class="hint">L'importazione sostituisce tutte le note salvate, dopo conferma.</p>
      <button id="persist" type="button" class="secondary">Richiedi conservazione persistente</button>
      <p class="hint">Il browser puo rifiutare la richiesta. Non sostituisce un backup.</p>
    </section>
  </main>
  <footer>Demo iniziale · Nessun database remoto · <span id="version"></span></footer>
`;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Elemento mancante: ${id}`);
  return found as T;
}

const form = element<HTMLFormElement>('note-form');
const title = element<HTMLInputElement>('title');
const content = element<HTMLTextAreaElement>('content');
const fileInput = element<HTMLInputElement>('backup-file');
const error = element<HTMLParagraphElement>('error');
const status = element<HTMLParagraphElement>('status');
let busy = false;

function reportError(cause: unknown): void {
  console.error(cause);
  error.textContent = cause instanceof Error ? cause.message : String(cause);
  error.hidden = false;
}

async function perform(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  error.hidden = true;
  status.textContent = '';
  const controls = app?.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>(
    'button, input, textarea',
  );
  controls?.forEach(control => { control.disabled = true; });
  try {
    await action();
  } catch (cause) {
    reportError(cause);
  } finally {
    busy = false;
    controls?.forEach(control => { control.disabled = false; });
  }
}

const dateFormat = new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' });

async function renderNotes(): Promise<void> {
  const notes = await db.notes.orderBy('updatedAt').reverse().toArray();
  const list = element<HTMLUListElement>('notes');
  list.replaceChildren();
  element('empty').hidden = notes.length > 0;
  for (const note of notes) {
    const item = document.createElement('li');
    const heading = document.createElement('h3');
    heading.textContent = note.title;
    const text = document.createElement('p');
    text.className = 'note-content';
    text.textContent = note.content;
    const time = document.createElement('p');
    time.className = 'hint';
    time.textContent = dateFormat.format(new Date(note.updatedAt));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = 'Elimina';
    remove.setAttribute('aria-label', `Elimina la nota ${note.title}`);
    remove.addEventListener('click', () => {
      if (!confirm(`Eliminare la nota "${note.title}"?`)) return;
      void perform(async () => {
        await db.notes.delete(note.id);
        await renderNotes();
        status.textContent = 'Nota eliminata.';
      });
    });
    item.append(heading, text, time, remove);
    list.append(item);
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  void perform(async () => {
    await addNote(title.value, content.value);
    form.reset();
    await renderNotes();
    status.textContent = 'Nota salvata sul dispositivo.';
  });
});

element('export').addEventListener('click', () => {
  void perform(async () => {
    const backup = await createBackup();
    const file = new File(
      [JSON.stringify(backup, null, 2)],
      `app-ila-backup-${new Date().toISOString().slice(0, 10)}.json`,
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = 'Download richiesto. Verifica il backup in File / Download.';
  });
});

element('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  void perform(async () => {
    const text = await file.text();
    const backup = parseBackup(text);
    if (!confirm(`Sostituire TUTTE le note salvate con le ${backup.notes.length} note del backup?`)) {
      status.textContent = 'Importazione annullata.';
      return;
    }
    await restoreBackup(text);
    await renderNotes();
    status.textContent = 'Backup importato.';
  });
});

element('persist').addEventListener('click', () => {
  void perform(async () => {
    if (!navigator.storage?.persist) {
      status.textContent = 'Questo browser non supporta la richiesta di conservazione persistente.';
      return;
    }
    const granted = await navigator.storage.persist();
    status.textContent = granted
      ? 'Conservazione persistente concessa. Mantieni comunque un backup.'
      : 'Conservazione persistente non concessa. Esporta regolarmente un backup.';
  });
});

function updateConnection(): void {
  element('connection').textContent = navigator.onLine ? 'Online' : 'Offline';
}
window.addEventListener('online', updateConnection);
window.addEventListener('offline', updateConnection);
updateConnection();

const standalone = window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && navigator.standalone === true);
element('installation').hidden = standalone;
element('version').textContent = `Build ${__BUILD_ID__}`;

let registration: ServiceWorkerRegistration | undefined;
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    element('update').hidden = false;
  },
  onOfflineReady() {
    element('offline-ready').hidden = false;
  },
  onRegisteredSW(_url, reg) {
    registration = reg;
  },
  onRegisterError(cause: unknown) {
    reportError(new Error('Installazione offline non riuscita. Riprova online.', { cause }));
  },
});

element('update-button').addEventListener('click', () => {
  if ((title.value || content.value) && !confirm('Ricaricare e perdere la nota non ancora salvata?')) {
    return;
  }
  void perform(async () => {
    await updateSW(true);
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine && registration) {
    void registration.update().catch(reportError);
  }
});

void perform(async () => {
  await renderNotes();
});
