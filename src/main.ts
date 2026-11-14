import { registerSW } from 'virtual:pwa-register';
import { formatDate, parseDate } from './dates';
import {
  addClinic,
  addTariffPeriod,
  addWorkEntry,
  archiveClinic,
  createBackup,
  currentMonth,
  db,
  deleteTariffPeriod,
  deleteWorkEntry,
  formatMoney,
  getMonthlySummary,
  getTariffForDate,
  parseBackup,
  parseHourlyRate,
  restoreBackup,
  todayDate,
  updateClinic,
  updateTariffPeriod,
  updateWorkEntry,
  type Clinic,
  type TariffPeriod,
  type WorkEntry,
  type WorkEntryInput,
} from './db';
import './style.css';

type Screen = 'home' | 'entries' | 'clinics' | 'backup';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Contenitore app mancante.');

app.innerHTML = `
  <header>
    <div><p class="eyebrow">AGENDA PROFESSIONALE</p><h1>Ore veterinarie</h1></div>
    <span id="connection" class="badge"></span>
  </header>
  <nav class="tabs" aria-label="Sezioni dell'app">
    <button type="button" data-screen="home">Riepilogo</button>
    <button type="button" data-screen="entries">Registro ore</button>
    <button type="button" data-screen="clinics">Studi e tariffe</button>
    <button type="button" data-screen="backup">Backup</button>
  </nav>
  <main>
    <aside id="update" class="card" hidden aria-live="polite">
      <h2>Nuova versione disponibile</h2>
      <p>Le registrazioni rimangono sul dispositivo.</p>
      <button id="update-button" type="button">Aggiorna ora</button>
    </aside>
    <p id="offline-ready" role="status" hidden>App pronta per funzionare offline.</p>
    <p id="error" role="alert" hidden></p>
    <p id="status" role="status"></p>
    <div id="view"></div>
  </main>
  <footer>Solo sul dispositivo · Nessun database remoto · <span id="version"></span></footer>
`;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Elemento mancante: ${id}`);
  return found as T;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function bindDateInput(input: HTMLInputElement, maxDate?: string): void {
  const validate = (): void => {
    input.setCustomValidity('');
    if (!input.value) return;
    if (/^\d{8}$/.test(input.value)) {
      input.value = `${input.value.slice(0, 2)}/${input.value.slice(2, 4)}/${input.value.slice(4)}`;
    }
    try {
      const date = parseDate(input.value);
      if (maxDate && date > maxDate) {
        input.setCustomValidity(`La data non può essere successiva al ${formatDate(maxDate)}.`);
      }
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      input.setCustomValidity(cause.message);
    }
  };
  input.addEventListener('input', validate);
  validate();
}

function monthLabel(value: string): string {
  const [year = '0', month = '1'] = value.split('-');
  return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' })
    .format(new Date(Number(year), Number(month) - 1, 1, 12));
}

function hoursLabel(hours: number): string {
  return `${hours} ${hours === 1 ? 'ora' : 'ore'}`;
}

const error = element<HTMLParagraphElement>('error');
const status = element<HTMLParagraphElement>('status');
const view = element<HTMLDivElement>('view');
let screen: Screen = 'home';
let selectedMonth = currentMonth();
let selectedClinicFilter = '';
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
  const controls = app?.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'button, input, select, textarea',
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

function showStatus(message: string): void {
  status.textContent = message;
  status.scrollIntoView({ block: 'nearest' });
}

function setScreen(next: Screen): void {
  screen = next;
  document.querySelectorAll<HTMLButtonElement>('[data-screen]').forEach(button => {
    const active = button.dataset.screen === next;
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  error.hidden = true;
  status.textContent = '';
  void perform(renderScreen);
}

document.querySelectorAll<HTMLButtonElement>('[data-screen]').forEach(button => {
  button.addEventListener('click', () => setScreen(button.dataset.screen as Screen));
});

function monthPicker(): string {
  return `<label class="month-picker" for="month-picker">Mese
    <input id="month-picker" type="month" value="${escapeHtml(selectedMonth)}" max="${currentMonth()}" />
  </label>`;
}

function bindMonthPicker(): void {
  element<HTMLInputElement>('month-picker').addEventListener('change', event => {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.value || input.value > currentMonth()) {
      input.value = selectedMonth;
      return;
    }
    selectedMonth = input.value;
    void perform(renderScreen);
  });
}

async function renderHome(): Promise<void> {
  const summary = await getMonthlySummary(selectedMonth);
  const current = selectedMonth === currentMonth();
  const clinics = await db.clinics.toArray();
  view.innerHTML = `
    <section class="page-heading">
      <div><p class="eyebrow">${current ? 'DAL 1 DEL MESE A OGGI' : 'RIEPILOGO DEL MESE'}</p>
        <h2>${escapeHtml(monthLabel(selectedMonth))}</h2></div>
      ${monthPicker()}
    </section>
    <section class="summary-grid" aria-label="Totali del mese">
      <article class="summary-card"><span>Compenso maturato</span>
        <strong>${formatMoney(summary.totalCents)}</strong></article>
      <article class="summary-card"><span>Ore lavorate</span>
        <strong>${hoursLabel(summary.totalHours)}</strong></article>
    </section>
    <div class="actions"><button id="quick-entry" type="button">+ Registra ore</button></div>
    <section class="card">
      <h2>Per studio</h2>
      ${summary.byClinic.length ? `<ul class="summary-list">${summary.byClinic.map(group => `
        <li><div><strong>${escapeHtml(group.clinicName)}</strong><span>${hoursLabel(group.hours)}</span></div>
          <strong>${formatMoney(group.cents)}</strong></li>`).join('')}</ul>`
        : '<p class="empty-state">Nessuna ora registrata in questo mese.</p>'}
    </section>
    <section class="card">
      <h2>Ultime registrazioni</h2>
      ${summary.entries.length ? `<ul class="compact-list">${summary.entries.slice(0, 5).map(entry => `
        <li><div><strong>${escapeHtml(clinics.find(clinic => clinic.id === entry.clinicId)?.name ?? 'Studio archiviato')}</strong>
          <span>${formatDate(entry.date)} · ${hoursLabel(entry.hours)}</span></div>
          <strong>${formatMoney(entry.amountCents)}</strong></li>`).join('')}</ul>
        <button id="all-entries" type="button" class="secondary">Apri registro</button>`
        : '<p class="empty-state">Le registrazioni del mese compariranno qui.</p>'}
    </section>
    ${summary.byClinic.length ? '<p class="hint">Il totale mostra il compenso maturato; non rappresenta pagamenti o fatture.</p>' : ''}
  `;
  bindMonthPicker();
  element('quick-entry').addEventListener('click', () => {
    screen = 'entries';
    void perform(renderEntries);
    document.querySelectorAll<HTMLButtonElement>('[data-screen]').forEach(button => {
      button.setAttribute('aria-current', button.dataset.screen === 'entries' ? 'page' : 'false');
    });
  });
  document.getElementById('all-entries')?.addEventListener('click', () => setScreen('entries'));
}

let editingEntryId: string | null = null;
let editingEntry: WorkEntry | null = null;

function clinicOptions(clinics: Clinic[], selected = ''): string {
  return clinics.map(clinic =>
    `<option value="${escapeHtml(clinic.id)}"${clinic.id === selected ? ' selected' : ''}>${escapeHtml(clinic.name)}</option>`,
  ).join('');
}

async function renderEntries(): Promise<void> {
  const [clinics, entries] = await Promise.all([
    db.clinics.toArray(),
    db.workEntries.where('date').between(`${selectedMonth}-01`, `${selectedMonth}-31`, true, true).toArray(),
  ]);
  const edit = editingEntry;
  const activeClinics = clinics.filter(clinic => !clinic.archivedAt);
  const selectedClinic = edit ? clinics.find(clinic => clinic.id === edit.clinicId) : undefined;
  const workFormClinics = selectedClinic?.archivedAt ? [...activeClinics, selectedClinic] : activeClinics;
  const clinicById = new Map(clinics.map(clinic => [clinic.id, clinic]));
  const visibleEntries = entries
    .filter(entry => !selectedClinicFilter || entry.clinicId === selectedClinicFilter)
    .sort((left, right) => right.date.localeCompare(left.date) ||
      (clinicById.get(left.clinicId)?.name ?? '').localeCompare(clinicById.get(right.clinicId)?.name ?? '', 'it'));
  view.innerHTML = `
    <section class="page-heading">
      <div><p class="eyebrow">REGISTRA E CONSULTA</p><h2>Registro ore</h2></div>
      ${monthPicker()}
    </section>
    <section class="card">
      <h2>${edit ? 'Modifica registrazione' : 'Nuove ore lavorate'}</h2>
      ${workFormClinics.length ? `
        <form id="work-form">
          <label for="work-clinic">Studio</label>
          <select id="work-clinic" name="clinicId" required>${clinicOptions(workFormClinics, edit?.clinicId)}</select>
          <label for="work-date">Data (GG/MM/AAAA)</label>
          <input id="work-date" name="date" type="text" inputmode="numeric" placeholder="GG/MM/AAAA"
            maxlength="10" value="${formatDate(edit?.date ?? todayDate())}" required />
          <label for="work-hours">Ore intere</label>
          <input id="work-hours" name="hours" type="number" min="1" step="1" inputmode="numeric"
            value="${edit?.hours ?? 1}" required />
          <label for="work-notes">Nota <span class="optional">(facoltativa)</span></label>
          <textarea id="work-notes" name="notes" rows="2" maxlength="10000">${escapeHtml(edit?.notes ?? '')}</textarea>
          <p id="work-preview" class="preview" aria-live="polite"></p>
          <div class="actions">
            <button type="submit">${edit ? 'Salva modifiche' : 'Salva ore'}</button>
            ${edit ? '<button id="cancel-edit" class="secondary" type="button">Annulla</button>' : ''}
          </div>
        </form>`
        : '<p class="empty-state">Aggiungi prima uno studio attivo e una tariffa per poter registrare le ore.</p><button id="go-clinics" type="button">Gestisci studi</button>'}
    </section>
    <section class="card">
      <div class="section-title"><h2>Registrazioni di ${escapeHtml(monthLabel(selectedMonth))}</h2>
        <label class="filter-label" for="clinic-filter">Studio</label>
        <select id="clinic-filter"><option value="">Tutti</option>${clinicOptions(clinics, selectedClinicFilter)}</select>
      </div>
      ${visibleEntries.length ? `<ul class="entry-list">${visibleEntries.map(entry => {
        const clinicName = clinicById.get(entry.clinicId)?.name ?? 'Studio archiviato';
        return `<li><div class="entry-details"><strong>${escapeHtml(clinicName)}</strong>
          <span>${formatDate(entry.date)} · ${hoursLabel(entry.hours)} × ${formatMoney(entry.hourlyRateCents)}/ora</span>
          ${entry.notes ? `<p>${escapeHtml(entry.notes)}</p>` : ''}</div>
          <div class="entry-result"><strong>${formatMoney(entry.amountCents)}</strong>
            <div class="actions compact-actions">
              <button type="button" class="secondary edit-entry" data-id="${escapeHtml(entry.id)}">Modifica</button>
              <button type="button" class="danger delete-entry" data-id="${escapeHtml(entry.id)}">Elimina</button>
            </div></div></li>`;
      }).join('')}</ul>`
        : '<p class="empty-state">Non ci sono registrazioni con questi filtri.</p>'}
    </section>
  `;
  bindMonthPicker();
  element<HTMLSelectElement>('clinic-filter').addEventListener('change', event => {
    selectedClinicFilter = (event.currentTarget as HTMLSelectElement).value;
    void perform(renderEntries);
  });
  document.getElementById('go-clinics')?.addEventListener('click', () => setScreen('clinics'));

  const form = document.getElementById('work-form') as HTMLFormElement | null;
  if (form) bindWorkForm(form);
  document.getElementById('cancel-edit')?.addEventListener('click', () => {
    editingEntryId = null;
    editingEntry = null;
    void perform(renderEntries);
  });
  view.querySelectorAll<HTMLButtonElement>('.edit-entry').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      void perform(async () => {
        editingEntry = id ? await db.workEntries.get(id) ?? null : null;
        if (!editingEntry) throw new Error('Registrazione non trovata.');
        editingEntryId = editingEntry.id;
        await renderEntries();
        element('work-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });
  view.querySelectorAll<HTMLButtonElement>('.delete-entry').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      const entry = visibleEntries.find(candidate => candidate.id === id);
      if (!id || !entry || !confirm(`Eliminare la registrazione del ${formatDate(entry.date)}?`)) return;
      void perform(async () => {
        await deleteWorkEntry(id);
        showStatus('Registrazione eliminata.');
        await renderEntries();
      });
    });
  });
}

function bindWorkForm(form: HTMLFormElement): void {
  const clinicInput = element<HTMLSelectElement>('work-clinic');
  const dateInput = element<HTMLInputElement>('work-date');
  const hoursInput = element<HTMLInputElement>('work-hours');
  const preview = element<HTMLParagraphElement>('work-preview');
  bindDateInput(dateInput, todayDate());

  const updatePreview = (): void => {
    void (async () => {
      const hours = Number(hoursInput.value);
      if (!clinicInput.value || !dateInput.validity.valid || !Number.isSafeInteger(hours) || hours < 1) {
        preview.textContent = 'Inserisci studio, data in formato GG/MM/AAAA e un numero intero positivo di ore.';
        preview.className = 'preview hint';
        return;
      }
      const date = parseDate(dateInput.value);
      const historicalRateCents = editingEntry &&
        date === editingEntry.date && clinicInput.value === editingEntry.clinicId
        ? editingEntry.hourlyRateCents
        : undefined;
      const tariff = historicalRateCents !== undefined
        ? undefined
        : await getTariffForDate(clinicInput.value, date);
      const hourlyRateCents = historicalRateCents ?? tariff?.hourlyRateCents;
      if (hourlyRateCents === undefined) {
        preview.textContent = 'Nessuna tariffa valida per questa data. Configura prima il periodo tariffario.';
        preview.className = 'preview warning';
        return;
      }
      preview.textContent = `Tariffa applicata: ${formatMoney(hourlyRateCents)}/ora · Compenso: ${formatMoney(hours * hourlyRateCents)}` +
        `${historicalRateCents !== undefined ? ' (importo storico)' : ''}`;
      preview.className = 'preview success';
    })().catch(reportError);
  };
  clinicInput.addEventListener('change', updatePreview);
  dateInput.addEventListener('input', updatePreview);
  hoursInput.addEventListener('input', updatePreview);
  updatePreview();

  form.addEventListener('submit', event => {
    event.preventDefault();
    void perform(async () => {
      const input: WorkEntryInput = {
        clinicId: clinicInput.value,
        date: parseDate(dateInput.value),
        hours: Number(hoursInput.value),
        notes: element<HTMLTextAreaElement>('work-notes').value,
      };
      if (editingEntryId) {
        await updateWorkEntry(editingEntryId, input);
        editingEntryId = null;
        editingEntry = null;
        showStatus('Registrazione aggiornata.');
      } else {
        await addWorkEntry(input);
        showStatus('Ore registrate.');
      }
      if (input.date.slice(0, 7) !== selectedMonth) selectedMonth = input.date.slice(0, 7);
      screen = 'entries';
      await renderEntries();
      document.querySelectorAll<HTMLButtonElement>('[data-screen]').forEach(button => {
        button.setAttribute('aria-current', button.dataset.screen === 'entries' ? 'page' : 'false');
      });
      element('work-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

let editingClinicId: string | null = null;
let editingTariffId: string | null = null;

async function renderClinics(): Promise<void> {
  const [clinics, tariffs, entries] = await Promise.all([
    db.clinics.orderBy('name').toArray(),
    db.tariffPeriods.toArray(),
    db.workEntries.toArray(),
  ]);
  const editingClinic = clinics.find(clinic => clinic.id === editingClinicId);
  const editingTariff = tariffs.find(tariff => tariff.id === editingTariffId);
  const activeClinics = clinics.filter(clinic => !clinic.archivedAt);
  const selectedTariffClinic = editingTariff?.clinicId ?? activeClinics[0]?.id ?? '';
  view.innerHTML = `
    <section class="page-heading"><div><p class="eyebrow">ANAGRAFICA E TARIFFE</p><h2>Studi</h2></div></section>
    <section class="card">
      <h2>${editingClinic ? 'Modifica studio' : 'Aggiungi uno studio'}</h2>
      <form id="clinic-form">
        <label for="clinic-name">Nome dello studio</label>
        <input id="clinic-name" name="name" maxlength="120" required value="${escapeHtml(editingClinic?.name ?? '')}" />
        <label for="clinic-notes">Note <span class="optional">(facoltative)</span></label>
        <textarea id="clinic-notes" name="notes" rows="2" maxlength="10000">${escapeHtml(editingClinic?.notes ?? '')}</textarea>
        <div class="actions"><button type="submit">${editingClinic ? 'Salva studio' : 'Aggiungi studio'}</button>
          ${editingClinic ? '<button id="cancel-clinic-edit" class="secondary" type="button">Annulla</button>' : ''}</div>
      </form>
    </section>
    <section class="card">
      <h2>${editingTariff ? 'Modifica periodo tariffario' : 'Aggiungi un periodo tariffario'}</h2>
      ${activeClinics.length || editingTariff ? `
        <form id="tariff-form">
          <label for="tariff-clinic">Studio</label>
          <select id="tariff-clinic" name="clinicId" required${editingTariff ? ' disabled' : ''}>${clinicOptions(
            editingTariff ? clinics : activeClinics,
            selectedTariffClinic,
          )}</select>
          <div class="date-grid">
            <div><label for="tariff-from">Valida dal (GG/MM/AAAA)</label>
              <input id="tariff-from" name="validFrom" type="text" inputmode="numeric" placeholder="GG/MM/AAAA"
                maxlength="10" value="${editingTariff ? formatDate(editingTariff.validFrom) : ''}" required /></div>
            <div><label for="tariff-to">Valida fino al (GG/MM/AAAA)</label>
              <input id="tariff-to" name="validTo" type="text" inputmode="numeric" placeholder="GG/MM/AAAA"
                maxlength="10" value="${editingTariff?.validTo ? formatDate(editingTariff.validTo) : ''}" />
              <span class="hint">Lascia vuoto per una tariffa senza scadenza.</span></div>
          </div>
          <label for="tariff-rate">Tariffa oraria (€)</label>
          <input id="tariff-rate" name="hourlyRate" type="number" min="0.01" step="0.01" inputmode="decimal"
            value="${editingTariff ? (editingTariff.hourlyRateCents / 100).toFixed(2) : ''}" required />
          <div class="actions"><button type="submit">${editingTariff ? 'Salva tariffa' : 'Aggiungi tariffa'}</button>
            ${editingTariff ? '<button id="cancel-tariff-edit" class="secondary" type="button">Annulla</button>' : ''}</div>
        </form>`
        : '<p class="empty-state">Aggiungi prima uno studio per impostarne la tariffa.</p>'}
    </section>
    ${clinics.length ? `<section class="card"><h2>I tuoi studi</h2>
      <div class="clinic-list">${clinics.map(clinic => {
        const clinicTariffs = tariffs.filter(period => period.clinicId === clinic.id)
          .sort((left, right) => right.validFrom.localeCompare(left.validFrom));
        const clinicEntryCount = entries.filter(entry => entry.clinicId === clinic.id).length;
        return `<article class="clinic-card${clinic.archivedAt ? ' archived' : ''}">
          <div class="section-title"><div><h3>${escapeHtml(clinic.name)}${clinic.archivedAt ? ' <span class="badge">Archiviato</span>' : ''}</h3>
            ${clinic.notes ? `<p>${escapeHtml(clinic.notes)}</p>` : ''}</div>
            <div class="actions compact-actions"><button type="button" class="secondary edit-clinic" data-id="${escapeHtml(clinic.id)}">Modifica</button>
            ${!clinic.archivedAt ? `<button type="button" class="secondary archive-clinic" data-id="${escapeHtml(clinic.id)}">Archivia</button>` : ''}</div>
          </div>
          <h4>Tariffe</h4>
          ${clinicTariffs.length ? `<ul class="tariff-list">${clinicTariffs.map(period => `
            <li><span>${formatDate(period.validFrom)} – ${period.validTo ? formatDate(period.validTo) : 'senza scadenza'}</span>
              <strong>${formatMoney(period.hourlyRateCents)}/ora</strong>
              <span class="actions compact-actions">
                <button type="button" class="secondary edit-tariff" data-id="${escapeHtml(period.id)}">Modifica</button>
                <button type="button" class="danger delete-tariff" data-id="${escapeHtml(period.id)}"
                  ${entries.some(entry => entry.tariffPeriodId === period.id) ? 'disabled title="Usato da registrazioni storiche"' : ''}>Elimina</button>
              </span>
            </li>`).join('')}</ul>` : '<p class="hint">Nessuna tariffa impostata.</p>'}
          <p class="hint">${clinicEntryCount} ${clinicEntryCount === 1 ? 'registrazione' : 'registrazioni'} conservate.</p>
        </article>`;
      }).join('')}</div>
    </section>` : '<section class="card"><p class="empty-state">Gli studi aggiunti compariranno qui.</p></section>'}
  `;

  element<HTMLFormElement>('clinic-form').addEventListener('submit', event => {
    event.preventDefault();
    void perform(async () => {
      const name = element<HTMLInputElement>('clinic-name').value;
      const notes = element<HTMLTextAreaElement>('clinic-notes').value;
      if (editingClinicId) {
        await updateClinic(editingClinicId, name, notes);
        editingClinicId = null;
        showStatus('Studio aggiornato.');
      } else {
        await addClinic(name, notes);
        showStatus('Studio aggiunto. Configura ora la tariffa oraria.');
      }
      await renderClinics();
    });
  });
  document.getElementById('cancel-clinic-edit')?.addEventListener('click', () => {
    editingClinicId = null;
    void perform(renderClinics);
  });
  document.getElementById('cancel-tariff-edit')?.addEventListener('click', () => {
    editingTariffId = null;
    void perform(renderClinics);
  });
  view.querySelectorAll<HTMLButtonElement>('.edit-clinic').forEach(button => {
    button.addEventListener('click', () => {
      editingClinicId = button.dataset.id ?? null;
      void perform(async () => {
        await renderClinics();
        element('clinic-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });
  view.querySelectorAll<HTMLButtonElement>('.archive-clinic').forEach(button => {
    button.addEventListener('click', () => {
      const clinic = clinics.find(candidate => candidate.id === button.dataset.id);
      if (!clinic || !confirm(`Archiviare ${clinic.name}? Resterà visibile nei riepiloghi e nello storico.`)) return;
      void perform(async () => {
        await archiveClinic(clinic.id);
        showStatus('Studio archiviato; lo storico è stato conservato.');
        await renderClinics();
      });
    });
  });
  view.querySelectorAll<HTMLButtonElement>('.edit-tariff').forEach(button => {
    button.addEventListener('click', () => {
      editingTariffId = button.dataset.id ?? null;
      void perform(async () => {
        await renderClinics();
        element('tariff-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });
  view.querySelectorAll<HTMLButtonElement>('.delete-tariff').forEach(button => {
    button.addEventListener('click', () => {
      const period = tariffs.find(candidate => candidate.id === button.dataset.id);
      if (!period) return;
      if (!confirm('Eliminare questo periodo tariffario? I periodi usati da registrazioni storiche non possono essere eliminati.')) {
        return;
      }
      void perform(async () => {
        await deleteTariffPeriod(period.id);
        showStatus('Periodo tariffario eliminato.');
        await renderClinics();
      });
    });
  });
  const tariffForm = document.getElementById('tariff-form') as HTMLFormElement | null;
  if (tariffForm) bindTariffForm(tariffForm, editingTariff, entries);
}

function bindTariffForm(form: HTMLFormElement, editing: TariffPeriod | undefined, entries: WorkEntry[]): void {
  const fromInput = element<HTMLInputElement>('tariff-from');
  const toInput = element<HTMLInputElement>('tariff-to');
  bindDateInput(fromInput);
  bindDateInput(toInput);
  form.addEventListener('submit', event => {
    event.preventDefault();
    void perform(async () => {
      const input = {
        clinicId: element<HTMLSelectElement>('tariff-clinic').value,
        validFrom: parseDate(fromInput.value),
        validTo: toInput.value ? parseDate(toInput.value) : null,
        hourlyRateCents: parseHourlyRate(element<HTMLInputElement>('tariff-rate').value),
      };
      if (editing) {
        const end = editing.validTo === null || input.validTo === null
          ? null
          : editing.validTo > input.validTo ? editing.validTo : input.validTo;
        const start = editing.validFrom < input.validFrom ? editing.validFrom : input.validFrom;
        const affected = entries.filter(entry =>
          entry.clinicId === editing.clinicId &&
          entry.date >= start &&
          (end === null || entry.date <= end),
        );
        const recalculate = affected.length > 0 && confirm(
          `Questo periodo riguarda ${affected.length} registrazioni. ` +
          'Vuoi ricalcolare i compensi storici usando il tariffario aggiornato? ' +
          'Scegli Annulla per conservare gli importi già applicati.',
        );
        await updateTariffPeriod(editing.id, input, recalculate);
        editingTariffId = null;
        showStatus(recalculate
          ? 'Tariffa aggiornata e registrazioni ricalcolate.'
          : 'Tariffa aggiornata. Gli importi storici sono stati conservati.');
      } else {
        await addTariffPeriod(input);
        showStatus('Periodo tariffario aggiunto.');
      }
      await renderClinics();
    });
  });
}

async function renderBackup(): Promise<void> {
  const [notes, clinics, tariffs, entries] = await Promise.all([
    db.notes.count(),
    db.clinics.count(),
    db.tariffPeriods.count(),
    db.workEntries.count(),
  ]);
  view.innerHTML = `
    <section class="page-heading"><div><p class="eyebrow">I TUOI DATI RESTANO QUI</p><h2>Backup</h2></div></section>
    <section class="card">
      <h2>Esporta tutti i dati</h2>
      <p>Il backup include studi, tariffe, registrazioni e dati delle versioni precedenti dell'app. Il file non è cifrato: conservalo in un posto sicuro.</p>
      <p class="hint">${clinics} ${clinics === 1 ? 'studio' : 'studi'} · ${tariffs} ${tariffs === 1 ? 'periodo tariffario' : 'periodi tariffari'} ·
        ${entries} ${entries === 1 ? 'registrazione' : 'registrazioni'}${notes ? ` · ${notes} note precedenti` : ''}</p>
      <button id="export" type="button">Esporta backup JSON</button>
    </section>
    <section class="card">
      <h2>Importa un backup</h2>
      <p>L'importazione sostituisce tutti i dati attualmente presenti. Prima crea un backup dei dati attuali e verifica di aver scelto il file giusto.</p>
      <button id="import" type="button" class="secondary">Scegli file JSON</button>
      <input id="backup-file" type="file" accept=".json,application/json" hidden />
    </section>
    <section class="card">
      <h2>Conservazione locale</h2>
      <p>I dati non si sincronizzano con altri dispositivi. La cancellazione dei dati del sito può eliminarli; esporta regolarmente un backup.</p>
      <button id="persist" type="button" class="secondary">Richiedi conservazione persistente</button>
      <p class="hint">Il browser può rifiutare la richiesta. Non sostituisce un backup.</p>
    </section>
  `;
  element('export').addEventListener('click', () => {
    void perform(async () => {
      const backup = await createBackup();
      const file = new File(
        [JSON.stringify(backup, null, 2)],
        `app-ila-backup-${todayDate()}.json`,
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
      showStatus('Download richiesto. Verifica il backup nell’app File.');
    });
  });
  const fileInput = element<HTMLInputElement>('backup-file');
  element('import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    void perform(async () => {
      const text = await file.text();
      const backup = parseBackup(text);
      const details = `${backup.clinics.length} studi, ${backup.tariffPeriods.length} tariffe e ${backup.workEntries.length} registrazioni`;
      if (!confirm(`Sostituire TUTTI i dati presenti con il backup (${details})?`)) {
        showStatus('Importazione annullata.');
        return;
      }
      await restoreBackup(text);
      showStatus('Backup ripristinato.');
      await renderBackup();
    });
  });
  element('persist').addEventListener('click', () => {
    void perform(async () => {
      if (!navigator.storage?.persist) {
        showStatus('Questo browser non supporta la richiesta di conservazione persistente.');
        return;
      }
      const granted = await navigator.storage.persist();
      showStatus(granted
        ? 'Conservazione persistente concessa. Mantieni comunque un backup.'
        : 'Conservazione persistente non concessa. Esporta regolarmente un backup.');
    });
  });
}

async function renderScreen(): Promise<void> {
  if (screen === 'home') await renderHome();
  else if (screen === 'entries') await renderEntries();
  else if (screen === 'clinics') await renderClinics();
  else await renderBackup();
}

function updateConnection(): void {
  element('connection').textContent = navigator.onLine ? 'Online' : 'Offline';
}
window.addEventListener('online', updateConnection);
window.addEventListener('offline', updateConnection);
updateConnection();

const buildLabel = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(__BUILD_ID__)
  ? `${formatDate(__BUILD_ID__.slice(0, 10))} ${__BUILD_ID__.slice(11, 16)} UTC`
  : __BUILD_ID__;
element('version').textContent = `Build ${buildLabel}`;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    element('update').hidden = false;
  },
  onOfflineReady() {
    element('offline-ready').hidden = false;
  },
  onRegisterError(cause: unknown) {
    reportError(new Error('Installazione offline non riuscita. Riprova online.', { cause }));
  },
});

element('update-button').addEventListener('click', () => {
  if (!confirm('Aggiornare e ricaricare l’app? I dati già salvati non cambiano.')) return;
  void perform(async () => { await updateSW(true); });
});

void perform(renderScreen);
