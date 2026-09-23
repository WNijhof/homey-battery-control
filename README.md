# Batterij Regeling (Homey)

Homey Pro app in de geest van [Home Battery Control](https://homebatterycontrol.com/): lokale, slimme
aansturing van een **Zendure SolarFlow 2400 AC(+)** op basis van een **HomeWizard P1-meter**,
**dynamische kwartierprijzen** (EPEX via EnergyZero, ENTSO-E als reserve) en een **zonverwachting**
(forecast.solar).

De volledige installatie-, test- en controlehandleiding staat in `docs/Handleiding-Batterij-Regeling.pdf`
(opnieuw aanmaken: `python tools/make_manual.py`).

## Demo-modus
Nieuwe apparaten starten in **demo-modus**: de app leest en berekent alles (plan, gewenst vermogen, opbrengst), maar stuurt nooit iets naar de Zendure. De batterij volgt zijn eigen programma. Boiler-Flows krijgen de voorwaarde *Demo-modus staat uit*, zodat ook de boiler zijn eigen programma houdt. Uitzetten via de instellingen of de Flow-kaart *Demo-modus aan/uit zetten*.

## Webpagina
Op `http://<ip van Homey>:8480` (alleen in het thuisnetwerk): alle metingen, het plan voor 24 uur, strategie en alle instellingen. Wijzigen met een pincode (instellingen → Webpagina); zonder pincode alleen-lezen.

## Strategieën

| Strategie | Wat het doet |
|---|---|
| Uit | Batterij stand-by |
| Zelfconsumptie | Nul op de meter: laden bij overschot, ontladen bij afname |
| Alleen laden met zon | Laadt van overschot, ontlaadt nooit |
| Nul import | Ontlaadt om afname te voorkomen, laadt nooit |
| Dynamische prijzen | Plan per kwartier; per periode (goedkoop / neutraal / duur) een instelbare actie. Laadt alleen wat nodig is, rekening houdend met zon |
| Geforceerd laden / ontladen | Vast vermogen tot een doel (%), daarna een vervolgstrategie |
| Stand-by / piekbegrenzing | Doet niets, behalve boven de import- of exportgrens |

Bovenop elke strategie (behalve Uit): optionele import- en exportgrens (piekbegrenzing) en hysterese tegen snel omschakelen.

Schema's maak je met Homey Flows (bijv. *om 23:00 → Strategie instellen: Zelfconsumptie*).

## Flow-kaarten
- **Als:** geplande actie is veranderd · strategie is veranderd · zonne-overschot is Y min boven/onder X W · demo-modus is veranderd
- **En:** strategie is … · geplande actie is … · prijs is lager dan … · zonne-overschot is hoger dan … · laadniveau is hoger dan … · demo-modus staat aan/uit
- **Dan:** strategie instellen · laden met X W · ontladen met X W · net-doelwaarde instellen · demo-modus aan/uit zetten

## Metingen
Laadniveau, batterijvermogen, net (P1), zonne-overschot, stroomprijs (all-in), geplande actie,
geladen/ontladen kWh, opbrengst vandaag/totaal (€), geleerd rendement, zonverwachting vandaag.

## Veiligheid
- Zonder P1-meting (3× mislukt) gaat de batterij bij strategieën die de meter nodig hebben naar stand-by.
- Bij stoppen of verwijderen van de app wordt de batterij op stand-by gezet.
- Laad-/ontlaadvermogens standaard 800 W (stopcontact).

## Installeren

> **Status:** deze app staat niet in de Homey App Store en is nog niet getest met echte hardware.
> Nieuwe apparaten starten daarom in **demo-modus**: de app kijkt alleen mee en stuurt de batterij niet aan.

**Nodig:** Homey Pro (2023 of nieuwer, firmware 12.3+), een computer met [Node.js](https://nodejs.org) 18 of nieuwer,
Zendure SolarFlow 2400 AC(+) met recente firmware, HomeWizard P1-meter.

**Voorbereiding**
1. Geef de Zendure en de P1-meter een vast IP-adres (DHCP-reservering in je router).
2. HomeWizard Energy-app → P1-meter → *Lokale API* aan (of later API v2 via *Repareren*).

**App op Homey zetten** (in een terminal):
```bash
npm install --global homey          # Homey CLI (eenmalig)
git clone https://github.com/WNijhof/homey-battery-control.git
cd homey-battery-control
homey login                          # inloggen met je Homey-account
homey select                         # kies je Homey Pro
homey app install                    # installeert de app permanent
```
Wil je live logs zien tijdens het testen: `homey app run --remote` (de app stopt dan als je de terminal sluit).

**Apparaat toevoegen**
1. Homey-app → *Apparaten* → **+** → *Batterij Regeling* → *Zendure SolarFlow (geregeld)*.
2. *Zoek in mijn netwerk* (10–20 s) of vul de IP-adressen zelf in → *Verbinden*.
3. Laat de app een paar dagen in demo-modus meekijken en vergelijk de waarden (handleiding hoofdstuk 6a).
4. Webpagina: open `http://<IP van je Homey>:8480`. Stel een pincode in (apparaat → instellingen → Webpagina)
   om daar ook te kunnen wijzigen.
5. Klopt alles: zet in de Zendure-app ZENKI / Smart Matching uit (hoofdstuk 5.2) en zet de demo-modus uit.

**Bijwerken:** `git pull` en daarna opnieuw `homey app install`. Instellingen blijven bewaard.

**Verwijderen:** Homey-app → Instellingen → Apps → Batterij Regeling → *Verwijderen*. Buiten demo-modus
zet de app de batterij daarbij eerst op stand-by; zet daarna het programma in de Zendure-app weer aan.

## Hoe het werkt
- Elke 5 s: P1 + Zendure uitlezen → set-point (`lib/controller.js`) → alleen schrijven bij verandering
  (`smartMode: 1`, geen flash-slijtage).
- Elke minuut: prijsplan (`lib/planner.js`): kandidaten per duur blok, daarna een energiesimulatie
  (laadniveau + zon − verbruik) die alleen de goedkoopste, winstgevende laadkwartieren inschakelt.
- Tests: `npm test` (de plannertest haalt live prijzen op).

## Licentie
MIT — zie [LICENSE](LICENSE). Geen garantie: je gebruikt deze app op eigen risico. Houd je aan de
toegestane vermogens van je elektrische installatie.
