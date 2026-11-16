# Ore veterinarie

PWA offline per registrare le ore lavorate in piu studi veterinari e calcolare
il compenso maturato. I dati sono locali: non esistono backend, account o
sincronizzazione fra dispositivi.

## Avvio e verifiche

Richiede Node.js 22.12 o successivo nella linea 22, oppure una versione LTS
successiva compatibile.

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

Su Windows `npm.cmd` evita il blocco di `npm.ps1` nelle configurazioni
PowerShell con script disabilitati. Su macOS/Linux usa `npm`.

Il Service Worker e attivo nella build di produzione: usa `preview` per provare
installazione e modalita offline. Per provarla su iPhone va pubblicata su un
indirizzo HTTPS e aggiunta alla schermata Home da Safari.

## Funzionalita

- **Riepilogo:** totale maturato nel mese corrente fino a oggi; per i mesi
  precedenti, riepilogo dell'intero mese. Mostra ore e importi per studio.
- **Registro ore:** una registrazione al giorno per studio, con data passata o
  odierna, ore a intervalli di mezz'ora (ad esempio `3` o `3,5`) e nota facoltativa.
  Le registrazioni si possono modificare o eliminare con conferma.
- **Date:** visualizzate e inserite come GG/MM/AAAA, anche nei periodi tariffari.
  Sulla tastiera numerica si possono digitare otto cifre (es. `14112026`):
  l'app aggiunge le barre. Date impossibili e prestazioni future sono rifiutate.
  Database e backup mantengono il formato ISO per compatibilita.
- **Studi:** nome e note facoltative. Uno studio puo essere archiviato, non
  cancellato: rimane disponibile nello storico e nei riepiloghi.
- **Tariffe:** importi in euro con al massimo due decimali, validi tra una data
  iniziale e una data finale inclusiva; la data finale vuota indica nessuna
  scadenza. I periodi dello stesso studio non possono sovrapporsi.
- **Calcolo:** la registrazione salva la tariffa e il compenso applicati come
  snapshot in centesimi. Correggendo ore o note conserva lo snapshot; cambiando
  data o studio usa la tariffa valida per la nuova selezione. Se manca una
  tariffa, la registrazione non viene salvata.
- **Storico delle tariffe:** cambiare un periodo non modifica i compensi gia
  registrati. L'app chiede conferma esplicita prima di ricalcolare le
  registrazioni nell'intervallo interessato. Se il nuovo tariffario lascia una
  data senza tariffa, il ricalcolo viene annullato.
- **Backup:** esporta o ripristina studi, tariffe, registrazioni e le note del
  vecchio scheletro. L'importazione sostituisce tutti i dati e richiede
  conferma. Sono accettati anche i backup v1 di sole note.

Gli importi rappresentano compensi maturati, non fatture o pagamenti. Non sono
incluse IVA, imposte, rimborsi, straordinari o tariffe speciali. Nello stesso
giorno si possono registrare piu studi. Gli importi sono arrotondati al centesimo
per registrazione.

## Icona dell'app

Il logo fornito e usato per l'icona iPhone da 180 x 180 px e per quelle PWA da
192 x 192 e 512 x 512 px, in [public](public). Il nome mostrato sotto l'icona
resta "Ore veterinarie". Se iPhone continua a mostrare una vecchia icona dopo
un aggiornamento, esporta prima un backup; poi rimuovi e aggiungi di nuovo la
PWA dalla schermata Home.

## Dati e migrazione

Il database IndexedDB mantiene il nome `app-ila`. L'aggiornamento da schema v1
a v2 conserva la precedente tabella note e aggiunge studi, periodi tariffari e
registrazioni. I backup v2 includono anche le note precedenti.

La tariffa e l'importo salvati su ogni registrazione proteggono la storia dalle
successive modifiche del tariffario. Eliminare un periodo tariffario usato da
registrazioni storiche non e consentito; si puo invece modificarlo, lasciando
gli importi storici invariati o ricalcolandoli dopo conferma.

Esporta regolarmente i dati: la richiesta di conservazione persistente puo
essere rifiutata e non sostituisce un backup. Il JSON non e cifrato: proteggi
il file. Chiunque abbia accesso all'archivio del browser puo vedere i dati.
Le note preesistenti restano archiviate e incluse nei backup, ma non hanno una
schermata dedicata in questa versione.

## GitHub Pages

Con GitHub Free il repository deve essere pubblico. Anche il sito pubblicato e
pubblico: non inserire dati personali nel codice o nei file pubblicati. I dati
di lavoro inseriti nell'app non vengono caricati sul repository o sull'hosting.

1. Crea un repository GitHub pubblico, ad esempio `App_Ila`.
2. Controlla i file e poi inizializza e pubblica il branch `main`:

   ```powershell
   git init -b main
   git add .
   git commit -m "Initial PWA"
   git remote add origin https://github.com/TUO-UTENTE/App_Ila.git
   git push -u origin main
   ```

3. In **Settings > Pages > Build and deployment > Source** seleziona
   **GitHub Actions**.
4. Se necessario, in **Actions** avvia **Deploy PWA to GitHub Pages**.
5. Apri l'URL pubblicato e, da Safari su iPhone, scegli
   **Condividi > Aggiungi alla schermata Home**.

Il workflow in [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
installa dal lockfile, esegue test e build e pubblica `dist` a ogni push su
`main`. Il percorso Pages viene configurato automaticamente.

Per fare il type-check e generare il bundle di un sito di progetto:

```powershell
$env:PAGES_BASE_PATH = "/App_Ila/"
npm.cmd run build
```

`vite preview` serve la cartella `dist` alla radice e non simula il montaggio
su una sottocartella GitHub Pages. Senza `PAGES_BASE_PATH`, `npm run build` e
`npm run preview` permettono di provare localmente alla radice; il workflow
GitHub configura e pubblica il percorso corretto.

Le release aggiornano i file della PWA, ma non cancellano IndexedDB. Un cambio
di dominio o percorso crea invece un archivio locale distinto: prima esporta
un backup.

## File principali

- [src/main.ts](src/main.ts): interfaccia, registro, riepiloghi, backup e update.
- [src/db.ts](src/db.ts): schema/migrazione, tariffe, registrazioni e backup.
- [src/db.test.ts](src/db.test.ts): test database, migrazioni e calcoli.
- [src/style.css](src/style.css): layout mobile.
- [vite.config.ts](vite.config.ts): percorso Pages, manifest e cache offline.

Non sono stati creati repository remoti o eseguiti commit/push automaticamente.
