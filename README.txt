Smart, local control of a Zendure SolarFlow 2400 AC(+) home battery from Homey, using a HomeWizard P1 meter, dynamic quarter-hour electricity prices and a solar forecast.

Strategies: self-consumption (zero on the meter), charge from solar only, zero import, dynamic prices (charge in cheap periods, discharge in expensive ones, with a configurable action per period), force charge or discharge until a target level, and standby / peak shaving. Optional grid import and export limits work on top of every strategy.

The price plan simulates the battery's energy over time: it only buys grid energy that is actually needed and profitable, taking the current charge level and the expected solar production into account.

New batteries start in demo mode: the app reads and calculates everything, but does not send commands, so the battery keeps its own program while you check the data. A local web page (http://<Homey IP>:8480) shows all data, the plan and all settings.

Requirements: Homey Pro (2023 or newer), a Zendure SolarFlow with the local API (zenSDK, recent firmware) and a HomeWizard P1 meter with the local API enabled, all in the same home network.

This is an unofficial app and is not affiliated with Zendure or HomeWizard. Always respect the allowed power of your electrical installation.
