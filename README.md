# Kalender

Ein gemeinsamer Online-Kalender nach dem Vorbild von kalender.digital. Er besteht nur aus HTML, CSS und JavaScript, braucht keinen Build-Schritt und läuft auf GitHub Pages. Datenbank und Anmeldung übernimmt Firebase im kostenlosen Spark-Tarif.

## Funktionen

- **Konten:** Kalender-Besitzer melden sich mit E-Mail und Passwort an und können ihr Passwort zurücksetzen.
- **Zugriffslinks ohne Login:** Besucher werden im Hintergrund anonym angemeldet. Pro Link und Unterkalender gibt es diese Stufen:
  - *Kein Zugriff*
  - *Ohne Details lesen:* zeigt nur „Belegt“
  - *Lesen*
  - *Hinzufügen:* neue Termine anlegen und eigene bearbeiten
  - *Bearbeiten*

  Dazu kommen Administrator-Links, optionale Passwörter, eigene Linknamen und ein Standard-Dunkelmodus pro Link.
- **Unterkalender** mit Farbe, ein- und ausblendbar, sortierbar.
- **Ansichten:** Tag, Woche, Monat, Jahr, Liste und Planer (Unterkalender × 14 Tage).
- **Termine:** ganztägig oder mit Uhrzeit, Ort, „Wer“, Beschreibung.
  - Wiederholungen: täglich, wöchentlich mit Wochentagen, monatlich oder jährlich, mit Intervall und Ende.
  - Bei Serien „nur dieser Termin“ oder „alle“.
  - Verschieben per Drag & Drop.
- **Anmeldungen** (optional mit Höchstzahl) und **Kommentare** zu Terminen.
- **Feiertage:** Deutschland je Bundesland, Österreich und Schweiz.
- **Suche, Statistik, Drucken/PDF.**
- **Export** als iCal (.ics) oder Excel (.csv), **Import** von .ics-Dateien.
- **Buchungslinks:** Buchende sehen nur freie Zeiten und tragen sich selbst ein.
  - Einstellbar sind Dauer, Öffnungszeiten, Vorlauf und Zeitraum.
  - Freie Zeiten werden in wählbaren Unterkalendern geprüft.
- **Einbetten** in Webseiten per `iframe`, auch für Info-Monitore. Änderungen erscheinen bei allen sofort.
- **Dunkelmodus.**

**Bewusst nicht enthalten**, weil dafür der kostenpflichtige Blaze-Tarif nötig wäre: E-Mail- und SMS-Erinnerungen, Benachrichtigungen, abonnierbare iCal-Feeds, automatischer Feed-Import und Dateianhänge.

**Vereinfachungen:**
- Alle Uhrzeiten gelten in der Kalenderzeit, ohne Umrechnung zwischen Zeitzonen.
- Die Woche beginnt immer am Montag.

## Ausprobieren ohne Firebase (Demo-Modus)

Solange in `js/firebase-config.js` kein `apiKey` steht, läuft die App im Demo-Modus. Alle Daten bleiben im localStorage dieses Browsers, und Berechtigungen werden nur in der Oberfläche geprüft.

Die App braucht einen Webserver, weil sie JavaScript-Module nutzt. Ein Doppelklick auf `index.html` reicht nicht. Zum Beispiel:

```bash
npx serve .
```

Danach `http://localhost:3000` öffnen.

## Einrichtung mit Firebase

1. **Projekt anlegen:** In der [Firebase-Konsole](https://console.firebase.google.com/) ein Projekt erstellen. Google Analytics ist nicht nötig.
2. **Web-App registrieren:** Unter *Projekteinstellungen → Allgemein → Deine Apps* die Web-App hinzufügen (Symbol `</>`). Das angezeigte `firebaseConfig`-Objekt in [js/firebase-config.js](js/firebase-config.js) eintragen.
   Diese Werte sind nicht geheim und dürfen öffentlich auf GitHub stehen. Die Daten schützen die Sicherheitsregeln aus Schritt 5.
3. **Anmeldung aktivieren:** Unter *Authentication → Sign-in method* zwei Anbieter einschalten:
   - **E-Mail/Passwort** für Kalender-Besitzer
   - **Anonym** für Besucher von Zugriffs- und Buchungslinks

   Unter *Authentication → Templates* kannst du die Sprache der E-Mails auf Deutsch stellen.
4. **Firestore anlegen:** Unter *Firestore Database → Datenbank erstellen* den Produktionsmodus wählen, als Standort zum Beispiel `europe-west3` (Frankfurt).
5. **Regeln einspielen:** Unter *Firestore Database → Regeln* den kompletten Inhalt von [firestore.rules](firestore.rules) einfügen und auf *Veröffentlichen* klicken.
6. **Domain freigeben:** Unter *Authentication → Einstellungen → Autorisierte Domains* deine GitHub-Pages-Domain hinzufügen, also `<dein-name>.github.io`. `localhost` ist dort schon eingetragen.

Zusätzliche Indizes sind nicht nötig. Alle Abfragen kommen mit den automatischen Einzelfeld-Indizes aus.

## Veröffentlichen auf GitHub Pages

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Kalender"
```

Anschließend auf GitHub ein leeres Repository anlegen und den Ordner dorthin hochladen:

```bash
git remote add origin https://github.com/<dein-name>/<repo>.git
```

```bash
git branch -M main
```

```bash
git push -u origin main
```

Dann im Repository unter *Settings → Pages* bei *Build and deployment* die Option *Deploy from a branch* wählen, als Branch `main` und als Ordner `/ (root)`. Nach ein bis zwei Minuten ist der Kalender unter `https://<dein-name>.github.io/<repo>/` erreichbar.

## Sicherheitsregeln prüfen

Nach der Einrichtung lohnt ein kurzer Test mit zwei Browsern, zum Beispiel einem normalen und einem privaten Fenster:

1. Im normalen Fenster registrieren, einen Kalender mit zwei Unterkalendern anlegen und Termine eintragen.
2. Einen Link anlegen: Unterkalender A auf *Lesen*, B auf *Ohne Details lesen*. Den Link im privaten Fenster öffnen.
   - In A siehst du alle Details, aber kein „+ Neuer Termin“.
   - In B steht nur „Belegt“.
3. Den Link auf *Hinzufügen* ändern. Im privaten Fenster lassen sich jetzt eigene Termine anlegen und bearbeiten, fremde Termine aber nicht.
4. Dem Link ein Passwort geben. Das private Fenster fragt nach dem Neuladen nach dem Passwort.
5. Den Link löschen. Das private Fenster verliert sofort den Zugriff.

Sollte ein Schritt mehr erlauben als erwartet, zeigt der *Regel-Playground* unter *Firestore → Regeln*, welche Regel greift.

## Hinweise

- **Passwortgeschützte Links:** Unter dem Linkschlüssel liegt nur ein Platzhalter. Der eigentliche Link liegt unter `sha256(Schlüssel:Passwort)` und ist ohne Passwort nicht auffindbar.
- **Passwort ändern:** Alle bisherigen Besucher müssen sich neu anmelden.
- **Linkverwaltung:** Administrator-Links dürfen Zugriffslinks verwalten. Falls Firestore die Linkliste für Administrator-Links verweigert, funktioniert die Verwaltung weiterhin über das Besitzerkonto.
- **Kostenloser Tarif:** Der Spark-Tarif erlaubt 50.000 Lese- und 20.000 Schreibvorgänge pro Tag. Für Vereine und Teams reicht das in der Regel deutlich.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html`, `css/style.css` | Seite und Gestaltung (hell/dunkel, mobil, Druck) |
| `js/app.js` | Anmeldung, Übersicht, Öffnen von Links |
| `js/calendar.js` | Kalenderseite und Live-Daten |
| `js/views.js` | Ansichten |
| `js/event-dialog.js` | Termin anzeigen und bearbeiten, Anmeldungen, Kommentare |
| `js/settings.js` | Einstellungen, Unterkalender, Zugriffs- und Buchungslinks |
| `js/booking.js` | Öffentliche Buchungsseite |
| `js/tools.js`, `js/ics.js` | Suche, Statistik, Import und Export |
| `js/dates.js`, `js/holidays.js` | Datum, Wiederholungen, Feiertage |
| `js/data.js` | Datenmodell |
| `js/backend*.js` | Firebase- bzw. Demo-Speicher |
| `firestore.rules` | Sicherheitsregeln |
