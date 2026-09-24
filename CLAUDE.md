# Batterij Regeling (Homey app) — werkbestand

Homey Pro-app (SDK 3, id `com.drpeppers.batterycontrol`, v0.6.0, Homey ≥ 12.3) die thuisbatterijen lokaal
aanstuurt: nul op de meter via een HomeWizard P1, dynamische kwartierprijzen en een zonverwachting.
Geïnspireerd op Home Battery Control (docs.homebatterycontrol.com). Repo: github.com/WNijhof/homey-battery-control.
Persoonlijke context (installatie, accounts, voorkeuren) staat in `CLAUDE.local.md` (niet in git).

## Status
- Alles is getest met simulaties en unit-tests, **niets met echte hardware**. Nieuwe apparaten starten in demo-modus.
- Simulatie (driver `simulator`, v0.6.0): batterij bestaat alleen in de app (`lib/batteries/simulator.js`), draait op de
  echte P1; `net met batterij = P1 − batterijvermogen`. Vergelijking met/zonder batterij in `lib/simstats.js`.
- Zendure: gebouwd voor de SolarFlow 2400 AC+ (zenSDK). Marstek en Anker: experimenteel (registers uit community-/officiële
  integraties, niet geverifieerd).
- Publicatie: via `homey app publish` → Athom-portaal → Test-release (niet in de App Store).

## Architectuur
| Pad | Rol |
|---|---|
| `app.js` | Prijsservice, Flow-kaarten (één keer voor alle merken), `batteries()`, webserver, logboek, `diagnosticsText()`, `settingsSchema(driverId)` |
| `lib/battery-device.js` | Gedeelde device-klasse: regellus (`tick`), prijsplan, demo-modus, opbrengst/rendement, overschot-triggers, `applySettings` (webpagina), `getWebData`, logging |
| `lib/battery-driver.js` | Gedeelde driver: pairing (`info`/`scan`/`configure`), repair (HomeWizard v2-token) |
| `lib/batteries/{zendure,marstek,anker}.js` | Merkkoppeling met interface `read()`, `setPower(w)`, `release()`, `close()` (+ static `identify`) |
| `lib/batteries/simulator.js`, `lib/simstats.js`, `drivers/simulator/` | Gesimuleerde SolarFlow 2400 AC+ (verlies = vast + ∝ vermogen, stand-by, reactietijd, taper) en de vergelijking met/zonder batterij (per dag, met/zonder saldering). Geen demo-modus en geen `battery_ip`; vermogen op `measure_power.battery` (telt niet in Homey Energy) |
| `drivers/<merk>/{device,driver}.js` | Dunne subklassen: `createBatteryClient()`, `brand()`, `identify()` |
| `drivers/<merk>/driver.compose.json`, `pair/`, `assets/` | **Gegenereerd** door `node tools/gen-drivers.js` uit `tools/driver-base.json` (+ `tools/pair/*`, `tools/images/*`). Niet met de hand bewerken |
| `lib/controller.js` | Strategieën → set-point (`computeTarget`), `shouldSend`, `goalFollowUp`, piek-/exportgrens, hysterese |
| `lib/planner.js` | Prijsplan: kandidaten per duur blok + energiesimulatie (`allocateCharging`) met SoC en zon |
| `lib/prices.js`, `lib/entsoe.js` | EnergyZero-kwartierprijzen (base_with_vat), ENTSO-E als reserve |
| `lib/forecast.js` | forecast.solar (lokale tijd → UTC) |
| `lib/surplus.js`, `lib/stats.js` | Zonne-overschot (1-min gemiddelde, "held X min"), opbrengst, geleerd rendement |
| `lib/homewizard.js`, `lib/http.js`, `lib/modbus.js`, `lib/scanner.js` | P1 v1/v2, HTTP-helper, Modbus TCP-client (geen dependencies), netwerkscan |
| `lib/webserver.js`, `web/index.html` | Lokale webpagina `:8480` (LAN-only, host-check, pincode + lockout), `/api/status`, `/api/settings`, `/api/strategy`, `/api/log`, `/api/diagnostics` |
| `lib/logbook.js` | Ringbuffer (3000 regels, 1500 bewaard in `homey.settings`), herhalingen samengevoegd, data-regel per minuut |
| `widgets/plan/` | Dashboardwidget |
| `tools/make_manual.py` | Genereert `docs/Handleiding-Batterij-Regeling.pdf` (reportlab, invulbare velden) |

## Conventies
- **Tekens:** intern set-point/`batteryPower` = **+ ontladen / − laden**; P1 `gridPower` = + afname / − teruglevering;
  Homey `measure_power` en `measure_power.setpoint` = **+ laden** (dus `-batteryPower`).
- Geen npm-dependencies in de app (alles met Node-built-ins). UI-teksten en foutmeldingen in het Nederlands, code/commentaar Engels.
- Stijl: 2 spaties, enkele quotes, trailing commas (athom/eslint-stijl), zoals de bestaande code.
- Zendure schrijft altijd met `smartMode: 1` (RAM, geen flash-slijtage).
- Demo-modus: **nooit** schrijven naar de batterij (ook niet bij P1-uitval of stoppen). Demo weer aan / app stopt → `release()`.
- Instellingen-id's mogen niet beginnen met `energy_` (Homey-reservering). `zendure_ip` is gemigreerd naar `battery_ip`.

## Werkwijze bij een wijziging
1. Code aanpassen; driver-instellingen alleen in `tools/driver-base.json` of `tools/gen-drivers.js`, dan `node tools/gen-drivers.js`.
2. `npm test` (alle tests; `planner.test.js` haalt live prijzen op) en `homey app validate --level publish`.
3. Gebruikerszichtbaar? Handleiding bijwerken in `tools/make_manual.py` en `python tools/make_manual.py` draaien;
   README.md, README.txt, README.nl.txt bijwerken.
4. Nieuwe versie: `.homeycompose/app.json` + `package.json` + `.homeychangelog.json` (en + nl) + versie in `make_manual.py` (`versie app x.y.z`).
5. `app.json` wordt door `homey app validate` gegenereerd uit `.homeycompose/` en `drivers/*/driver.compose.json`:
   **altijd meecommitten** (niet terugdraaien). Nooit met de hand bewerken.
6. Commit met `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; git-identiteit in deze repo is DrPeppers.

## Valkuilen in deze omgeving (Windows)
- Bash-heredocs en geneste quotes in `node -e` gaan vaak mis: gebruik Write/Edit of een tijdelijk `tools/patch_*.py`-bestand.
- Een hook blokkeert schrijven buiten `C:\Users\WS18\Documents\Claude Code` en `C:\Users\WS18\.claude` (ook `-o /dev/null` en
  sommige escape-reeksen in commando's). Scratch-bestanden dus binnen de projectmap (bijv. `tools/preview/`, staat in .gitignore).
- In PowerShell zijn `npm`/`homey` geblokkeerd door de execution policy: gebruik `homey.cmd` / `npm.cmd`.
- `homey app install` werkt alleen in hetzelfde LAN als de Homey; op afstand: publiceren als test-release.
- Webpagina bekijken zonder Homey: `node tools/preview-web.js` (poort 8480, live prijzen, voorbeelddata) en screenshot met
  headless Edge (`msedge.exe --headless=new --screenshot=... http://127.0.0.1:8480/`).

## Diagnosebestand lezen (van de gebruiker)
Kop: versies, prijzen, per batterij metingen/instellingen (geheimen gemaskeerd)/plan. Daarna het logboek:
`dd-mm-jjjj, uu:mm:ss  NIVEAU [bron] bericht`. Niveaus: INFO, ERROR, DATA. DATA-regel per minuut:
`soc=… batterij=…W net=…W gewenst=…W overschot=…W strategie=… plan=… prijs=… DEMO|LIVE (reden)`.
Controleer bij problemen eerst: teken batterij vs. net, `gewenst` t.o.v. `net`, P1-uitval, strategie/plan-wissels.

## Openstaand / nog te verifiëren op hardware
- Handleiding-tests T1–T16 (hfdst. 8, 13) zijn nog door niemand uitgevoerd.
- Teken `measure_power` in Homey Energy (aanname: + laden) en `homeBattery`-weergave.
- Marstek/Anker: teken van het batterijvermogen, registerwaarden (Venus E v3 SOC ×0,1), gedrag van `release()`.
- HomeWizard API v2-koppeling, netwerkscan, widget en ENTSO-E (geen token) nooit echt getest.
- Webpagina toont bij meerdere batterijen alleen de eerste.
- Zendure `release()` = stand-by; terugkeer naar ZENKI moet de gebruiker in de Zendure-app doen.

## Bronnen
zenSDK: github.com/Zendure/zenSDK · Zendure-HA (commando's) · Anker lokaal: github.com/anker-charging/ha-anker-solix-official ·
Marstek Modbus: github.com/ViperRNMC/marstek_venus_modbus · HomeWizard API: api-documentation.homewizard.com ·
Prijzen: public.api.energyzero.nl · Zon: forecast.solar · Homey widgets: apps.developer.homey.app/the-basics/widgets
