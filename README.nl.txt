Slimme, lokale aansturing van een Zendure SolarFlow 2400 AC(+) thuisbatterij vanuit Homey, op basis van een HomeWizard P1-meter, dynamische kwartierprijzen en een zonverwachting.

Strategieën: zelfconsumptie (nul op de meter), alleen laden met zon, nul import, dynamische prijzen (laden in goedkope periodes, ontladen in dure, met een instelbare actie per periode), geforceerd laden of ontladen tot een doel, en stand-by / piekbegrenzing. Een optionele import- en exportgrens werkt bovenop elke strategie.

Het prijsplan simuleert de energie in de batterij door de tijd heen: het koopt alleen stroom uit het net die echt nodig is en winst oplevert, rekening houdend met het huidige laadniveau en de verwachte zonne-opbrengst.

Nieuwe batterijen starten in demo-modus: de app leest en berekent alles, maar stuurt geen opdrachten, zodat de batterij zijn eigen programma houdt terwijl jij de gegevens controleert. Een lokale webpagina (http://<IP van Homey>:8480) toont alle gegevens, het plan en alle instellingen.

Vereisten: Homey Pro (2023 of nieuwer), een Zendure SolarFlow met de lokale API (zenSDK, recente firmware) en een HomeWizard P1-meter met de lokale API aan, allemaal in hetzelfde thuisnetwerk.

Dit is een onofficiële app en is niet verbonden aan Zendure of HomeWizard. Houd je altijd aan het toegestane vermogen van je elektrische installatie.
