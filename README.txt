Smart, local control of your home battery from Homey, using a HomeWizard P1 meter, dynamic quarter-hour electricity prices and a solar forecast.

Supported batteries (local control, no cloud):
- Zendure SolarFlow 800, 800 Plus, 800 Pro, 1600 AC+, 2400 AC, 2400 AC+ and 2400 Pro (local zenSDK API)
- Marstek Venus E (v1/v2/v3), Venus A and Venus D (Modbus TCP; v3 via its Ethernet port, others via an RS485 bridge)
- Anker SOLIX Solarbank Max AC, Solarbank Max, XE and Solarbank 4 E5000 Pro (official local Modbus TCP)
Marstek and Anker support is experimental: check the data in demo mode first.
No battery yet? Add a simulated battery with the measured behaviour of a Zendure SolarFlow 2400 AC+. It runs on your real P1 meter and shows what the battery would have done in your home: grid import and export with and without battery, cycles and savings with and without net metering. A simulated P1 meter shows, every 1–2 seconds, what your P1 meter would read with the battery, and the web page has a live chart of the last 5 minutes.

Strategies: self-consumption (zero on the meter), charge from solar only, zero import, dynamic prices (charge in cheap periods, discharge in expensive ones, with a configurable action per period), force charge or discharge until a target level, and standby / peak shaving. Optional grid import and export limits work on top of every strategy.

The price plan simulates the battery's energy over time: it only buys grid energy that is actually needed and profitable, taking the current charge level and the expected solar production into account.

New batteries start in demo mode: the app reads and calculates everything, but does not send commands, so the battery keeps its own program while you check the data. A local web page (http://<Homey IP>:8480) shows all data, the plan and all settings.

Requirements: Homey Pro (2023 or newer), a supported battery and a HomeWizard P1 meter with the local API enabled, all in the same home network.

This is an unofficial app and is not affiliated with Zendure, Marstek, Anker or HomeWizard. Always respect the allowed power of your electrical installation.
