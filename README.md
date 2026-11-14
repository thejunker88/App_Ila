# App Ila

Scheletro PWA in italiano: Vite + TypeScript, IndexedDB tramite Dexie e Service
Worker generato da `vite-plugin-pwa`. Le note sono un esempio da sostituire con
le funzionalita dell'app definitiva. Nessun backend, database remoto, analytics
o risorsa caricata da CDN.

## Avvio locale

Richiede Node.js 22.12 o successivo nella linea 22, oppure una versione LTS
successiva compatibile.

```powershell
npm.cmd ci
npm.cmd run dev
```

Apri l'indirizzo mostrato nel terminale. Su Windows usiamo `npm.cmd` per evitare
il blocco di `npm.ps1` nelle configurazioni PowerShell con script disabilitati.
Su macOS/Linux usa `npm`.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

Il Service Worker e attivo **nella build di produzione**, non nel server di
sviluppo: usa `preview` per verificare offline e installazione. Su localhost
HTTP e consentito; sull'iPhone serve un indirizzo HTTPS. Il localhost del PC
non e raggiungibile dall'iPhone: pubblica su Pages per provarla realmente.

## Pubblicazione gratuita su GitHub Pages

**Correzione rispetto alla discussione iniziale:** con GitHub Free il repository
deve essere **pubblico**. Pages su repository privati richiede un piano abilitato.
Il sito pubblicato e normalmente pubblico anche se il repository e privato.
Non diffondere il link non equivale a un controllo di accesso.

1. Crea su GitHub un repository pubblico, ad esempio `App_Ila`. Per il primo
   caricamento lascialo vuoto (senza README o gitignore generati da GitHub).
2. Da questa cartella, dopo aver verificato che non contenga dati o segreti:

   ```powershell
   git init -b main
   git add .
   git commit -m "Initial PWA scaffold"
   git remote add origin https://github.com/TUO-UTENTE/App_Ila.git
   git push -u origin main
   ```

3. In GitHub apri **Settings > Pages > Build and deployment > Source** e scegli
   **GitHub Actions**.
4. Nella scheda **Actions** scegli **Deploy PWA to GitHub Pages > Run workflow**.
   Serve per il primo deploy se il push e avvenuto prima di abilitare Pages.
5. Quando il workflow e verde, apri l'URL indicato dal deploy, normalmente
   `https://TUO-UTENTE.github.io/App_Ila/`.

Il [workflow](.github/workflows/deploy.yml) installa dal lockfile, esegue test e
build e pubblica `dist`. Ricava il percorso da `actions/configure-pages`:
funziona anche per repository `TUO-UTENTE.github.io` o domini personalizzati.
Il nome del repository non e fissato nel codice.

Per simulare localmente il percorso di un sito di progetto:

```powershell
$env:PAGES_BASE_PATH = "/App_Ila/"
npm.cmd run build
npm.cmd run preview
# Apri http://127.0.0.1:4173/App_Ila/
```

In una nuova shell la variabile non rimane impostata. Per tornare alla radice
nella stessa shell: `Remove-Item Env:PAGES_BASE_PATH`, poi ricostruisci.

## Installazione e prova sull'iPhone

1. Apri l'URL HTTPS in Safari.
2. Tocca **Condividi > Aggiungi alla schermata Home** (abilita l'apertura come
   app web se iOS propone l'opzione).
3. Avvia dall'icona e attendi il messaggio **App pronta per funzionare offline**.
4. Inserisci una nota, chiudi l'app, attiva la modalita aereo e riaprila.
5. Verifica che la nota sia presente e che si possano salvare altre note offline.
6. Prova esportazione e importazione con un backup prima di affidarle dati reali.

Installa prima di inserire dati importanti: Safari e la PWA installata possono
avere archivi separati. Le icone PNG incluse sono segnaposto.

## Aggiornamenti

Modifica il codice e fai push su `main`. La pubblicazione avviene automaticamente
se test e build passano. Quando l'app torna online e viene aperta, o riportata
in primo piano, verifica il Service Worker.

Un aggiornamento disponibile mostra il pulsante **Aggiorna ora**. La vecchia
versione continua a funzionare fino all'attivazione. Il pulsante ricarica l'app;
se c'e una nota non salvata viene chiesta conferma. La build e visibile a fondo
pagina per verificare quale versione e in uso.

La sostituzione delle cache dell'app **non cancella IndexedDB**. Non cambiare
il nome `app-ila` del database per aggiornare uno schema. Aggiungi una nuova
versione e una migrazione in [src/db.ts](src/db.ts), conservando le versioni
precedenti. Se cambi il formato di backup, gestisci anche i vecchi backup
esplicitamente: la versione del backup e distinta dalla versione dello schema DB.

Non rinominare repository, dominio o percorso dell'app dopo aver inserito dati
senza esportarli: l'installazione puo cambiare e un cambio di origine crea un
archivio distinto.

## Dati e backup

- I dati restano nel browser di quel dispositivo, senza sincronizzazione.
- **Esporta backup** scarica un JSON. Su iPhone verifica il file in File /
  Download; da li puoi condividerlo o copiarlo nella destinazione preferita.
- **Importa backup** valida formato, versione, date e identificativi, poi chiede
  conferma prima di sostituire tutte le note. L'operazione e transazionale:
  se la scrittura fallisce, conserva il database precedente.
- Il backup non e cifrato: conservalo in una posizione adeguata ai dati.
- La richiesta di conservazione persistente puo essere rifiutata o non
  supportata. Anche se concessa, l'utente puo cancellare i dati del sito.
- La PWA non garantisce la permanenza assoluta dei dati, ne backup automatici.
  Quote e gestione dello spazio dipendono dal browser e da iOS.
- Nessuna password o autenticazione e inclusa in questo scheletro. Chi usa
  il dispositivo e il relativo archivio del browser puo accedere alle note.
- Il codice non invia le note all'hosting. GitHub riceve comunque le richieste
  HTTP per distribuire i file dell'app e puo registrarle.

## File principali

- [src/main.ts](src/main.ts): interfaccia, backup, stato rete e aggiornamenti.
- [src/db.ts](src/db.ts): database e validazione/importazione.
- [src/db.test.ts](src/db.test.ts): persistenza, backup invalidi e rollback.
- [src/style.css](src/style.css): layout mobile e safe area iPhone.
- [vite.config.ts](vite.config.ts): base path, manifest e cache offline.
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml): deploy Pages.

Non sono stati creati repository remoti o eseguiti commit/push automaticamente.

## Verifiche eseguite sullo scheletro

- Type-check, build di produzione e quattro test database superati.
- Nel browser Chromium integrato, con viewport 390 x 844: riapertura e salvataggio
  con rete bloccata, dati presenti dopo aggiornamento, JSON di esportazione e
  importazione valida/non valida verificati sotto `/App_Ila/`.
- Il browser integrato non ha consentito di verificare il salvataggio fisico
  del download. Verifica il file scaricato e l'installazione su Safari/iPhone
  reale dopo il deploy.
- `npm audit --omit=dev`: zero segnalazioni. L'audit completo segnala sei
  dipendenze di sviluppo nella catena Workbox (due low, quattro moderate) anche
  con le versioni attuali installate. Il fix automatico proposto retrocede il
  plugin PWA: non e stato applicato `--force`. Queste segnalazioni vanno
  rivalutate prima di adottare lo scheletro in produzione.
