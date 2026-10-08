# Finanzplaner (Web/PWA)

Single-Page-App ohne Build-Schritt. Läuft auf GitHub Pages, ist am Handy installierbar (PWA) und synchronisiert die Daten über ein **privates** GitHub-Repo.

## Dateien
`index.html` · `app.js` · `chart.min.js` · `sw.js` · `manifest.webmanifest` · `icons/` · `.nojekyll`
Die App-Dateien enthalten **keine persönlichen Daten** (leere Startwerte).

## Einrichtung (einmalig, ca. 10 Min.)

### 1. App-Repo (öffentlich) + GitHub Pages
1. github.com → **New repository** → Name z. B. `finanzplaner`, **Public**.
2. Alle Dateien dieses Ordners hochladen (Add file → Upload files; `icons/` als Ordner mitziehen, `.nojekyll` nicht vergessen).
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, Ordner `/ (root)` → Save.
4. Nach ~1 Min. erreichbar unter `https://DEIN-NAME.github.io/finanzplaner/`.

### 2. Daten-Repo (privat)
1. **New repository** → Name z. B. `finanzplaner-daten`, **Private**, mit „Add a README“ (damit der Branch `main` existiert).
2. Die Datei `finanzplan-daten.json` legt die App beim ersten Sync selbst an.

### 3. Token erstellen
GitHub → Profilbild → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
- Repository access: **Only select repositories** → nur `finanzplaner-daten`
- Permissions → Repository permissions → **Contents: Read and write**
- Laufzeit: bis zu 1 Jahr (danach neues Token erzeugen)

### 4. In der App verbinden
⚙ → Cloud-Sync: Benutzer, Repo `finanzplaner-daten`, Token eintragen → **Speichern & verbinden**. Das Gleiche einmal pro Gerät (PC, Handy).

### 5. Bestehende Daten übernehmen
Alte Version (Finanzplaner_v2.html) öffnen → **Export** → in der neuen App ⚙ → **Import**. Der Sync lädt sie in die Cloud; am Handy erscheinen sie nach dem Verbinden automatisch.

### 6. Am Handy installieren
- **Android/Chrome:** Seite öffnen → Menü ⋮ → *App installieren / Zum Startbildschirm*.
- **iPhone/Safari:** Teilen-Symbol → *Zum Home-Bildschirm*.
Danach PIN setzen (⚙ → PIN-Sperre).

## Bedienung (v2)
- Unten 5 Tabs: Übersicht, Budget, Urlaub, Zukunft, Mehr (Verlauf, Versicherungen, Notizen, Einstellungen, Sperren).
- Einträge erscheinen als Liste; Antippen öffnet das Bearbeiten-Fenster. Der **＋**-Button legt neue Einträge an.
- Budget/Urlaub: immer nur ein Bereich aufgeklappt. Zukunft: Unterreiter Vermögen / Eigenheim / Vorsorge / Budget.
- Urlaub: ein geplanter Betrag je Position (statt Min/Max). Bestehende Min/Max-Werte werden beim ersten Laden gemittelt.
- Budgetplanung (Zukunft) nutzt die aktuellen Fixkosten aus dem Budget-Tab × Inflationsfaktor (eigene Fixkostenliste entfällt).

- Verlinkungen: Kennzahlen, Sparziele, Hinweise und aus anderen Bereichen stammende Werte (mit „›“) springen direkt zum passenden Block. Die Zurück-Taste führt zurück.

## Verhalten
- Änderungen werden ~2 s nach der Eingabe in die Cloud geschrieben; beim Öffnen/Zurückkehren wird der Cloud-Stand geholt. „Neuester Stand gewinnt“, bei Konflikt fragt die App.
- Offline nutzbar; Änderungen werden nachgesendet, sobald wieder Netz da ist.
- Jede Änderung ist ein Commit im Daten-Repo → Versionsverlauf/Backup gratis.
- **Update der App:** Dateien im App-Repo ersetzen und in `sw.js` `CACHE` hochzählen (`v2`, `v3` …), sonst zeigt das Handy ggf. noch die alte Version.

## Sicherheit
- Die PIN ist eine Sperre der Oberfläche auf dem jeweiligen Gerät, **keine Verschlüsselung**. Das Token liegt im Browserspeicher des Geräts – bei Geräteverlust Token in GitHub widerrufen.
- Daten-Repo muss **privat** bleiben.
