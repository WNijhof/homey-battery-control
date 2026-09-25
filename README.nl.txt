Slimme, lokale aansturing van je thuisbatterij vanuit Homey, op basis van een HomeWizard P1-meter, dynamische kwartierprijzen en een zonverwachting.

Ondersteunde batterijen (lokaal, zonder cloud):
- Zendure SolarFlow 800, 800 Plus, 800 Pro, 1600 AC+, 2400 AC, 2400 AC+ en 2400 Pro (lokale zenSDK-API)
- Marstek Venus E (v1/v2/v3), Venus A en Venus D (Modbus TCP; v3 via de netwerkpoort, de andere via een RS485-adapter)
- Anker SOLIX Solarbank Max AC, Solarbank Max, XE en Solarbank 4 E5000 Pro (officiële lokale Modbus TCP)
Marstek en Anker zijn experimenteel: controleer eerst de gegevens in demo-modus.
Nog geen batterij? Voeg een gesimuleerde batterij toe met het gemeten gedrag van een Zendure SolarFlow 2400 AC+. Die draait op je echte P1-meter en laat zien wat de batterij in jouw huis had gedaan: afname en teruglevering met en zonder batterij, cycli en opbrengst met en zonder saldering. Het laadniveau staat in een eigen tegel. Een gesimuleerde P1-meter laat elke 1–2 seconden zien wat je P1-meter mét batterij zou meten, en de webpagina toont een live grafiek van de laatste 5 minuten.

Strategieën: zelfconsumptie (nul op de meter), alleen laden met zon, nul import, dynamische prijzen (laden in goedkope periodes, ontladen in dure, met een instelbare actie per periode), geforceerd laden of ontladen tot een doel, en stand-by / piekbegrenzing. Een optionele import- en exportgrens werkt bovenop elke strategie.

Het prijsplan simuleert de energie in de batterij door de tijd heen: het koopt alleen stroom uit het net die echt nodig is en winst oplevert, rekening houdend met het huidige laadniveau en de verwachte zonne-opbrengst.

Nieuwe batterijen starten in demo-modus: de app leest en berekent alles, maar stuurt geen opdrachten, zodat de batterij zijn eigen programma houdt terwijl jij de gegevens controleert. Een lokale webpagina (http://<IP van Homey>:8480) toont alle gegevens, het plan en alle instellingen.

Vereisten: Homey Pro (2023 of nieuwer), een ondersteunde batterij en een HomeWizard P1-meter met de lokale API aan, allemaal in hetzelfde thuisnetwerk.

Dit is een onofficiële app en is niet verbonden aan Zendure, Marstek, Anker of HomeWizard. Houd je altijd aan het toegestane vermogen van je elektrische installatie.
