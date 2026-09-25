'use strict';

/**
 * Generates drivers/<brand>/driver.compose.json, the pair views and the driver images from
 * one shared definition (tools/driver-base.json), so the brands never drift apart.
 * Usage: node tools/gen-drivers.js   (run after changing tools/driver-base.json)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'driver-base.json'), 'utf8'));

const connectionModbus = [
  {
    id: 'modbus_port',
    type: 'number',
    label: { en: 'Modbus TCP port', nl: 'Modbus TCP-poort' },
    hint: { en: 'Usually 502.', nl: 'Meestal 502.' },
    value: 502,
    min: 1,
    max: 65535,
  },
  {
    id: 'modbus_unit',
    type: 'number',
    label: { en: 'Modbus unit ID', nl: 'Modbus unit-ID' },
    hint: { en: 'Usually 1.', nl: 'Meestal 1.' },
    value: 1,
    min: 0,
    max: 247,
  },
];

const invertPower = {
  id: 'invert_power',
  type: 'checkbox',
  label: { en: 'Invert battery power sign', nl: 'Teken batterijvermogen omdraaien' },
  hint: {
    en: 'Turn on when the app shows charging while the battery is discharging (check this in demo mode).',
    nl: 'Aanzetten als de app laden toont terwijl de batterij ontlaadt (controleer dit in demo-modus).',
  },
  value: false,
};

const num = (id, value, min, max, label, hint, extra = {}) => ({
  id, type: 'number', label, hint, value, min, max, ...extra,
});

// Simulated battery: defaults are the measured values of a SolarFlow 2400 AC+ (see the manual)
const simulation = {
  type: 'group',
  label: { en: 'Simulation', nl: 'Simulatie' },
  children: [
    num('sim_start_soc', 50, 0, 100, { en: 'Start level (%)', nl: 'Startniveau (%)' }, {
      en: 'Changing this value resets the simulated battery to this level.',
      nl: 'Als je deze waarde wijzigt, begint de gesimuleerde batterij opnieuw op dit niveau.',
    }),
    num('sim_rte', 88, 60, 98, { en: 'Round-trip efficiency at 800 W (%)', nl: 'Rendement heen en terug bij 800 W (%)' }, {
      en: 'AC to AC. Reviews measured 87–88 % for the SolarFlow 2400 AC+ (Zendure claims up to 93 %).',
      nl: 'Van stopcontact naar stopcontact. Reviews maten 87–88 % bij de SolarFlow 2400 AC+ (Zendure noemt tot 93 %).',
    }),
    num('sim_overhead_w', 8, 0, 50, { en: 'Fixed conversion loss (W)', nl: 'Vast omzettingsverlies (W)' }, {
      en: 'Loss per direction while charging or discharging, regardless of the power. Makes low powers less efficient: with 8 W the round trip is about 81 % at 150 W (reviews: 78–82 % at 100–200 W).',
      nl: 'Verlies per richting tijdens laden of ontladen, los van het vermogen. Maakt kleine vermogens minder zuinig: met 8 W is het rendement ongeveer 81 % bij 150 W (reviews: 78–82 % bij 100–200 W).',
    }),
    num('sim_standby_w', 0.7, 0, 20, { en: 'Standby from the grid (W)', nl: 'Stand-by uit het net (W)' }, {
      en: 'Power the idle battery draws from the socket (measured: 0.7 W).',
      nl: 'Vermogen dat de batterij in rust uit het stopcontact haalt (gemeten: 0,7 W).',
    }, { step: 0.1 }),
    num('sim_idle_drain_w', 2.7, 0, 20, { en: 'Standby from the battery (W)', nl: 'Stand-by uit de accu (W)' }, {
      en: 'Power the idle battery takes from its own cells (measured: about 2.7 W, roughly 65 Wh per day).',
      nl: 'Vermogen dat de batterij in rust uit de eigen accu haalt (gemeten: circa 2,7 W, ongeveer 65 Wh per dag).',
    }, { step: 0.1 }),
    num('sim_delay_s', 3, 0, 30, { en: 'Response delay (s)', nl: 'Reactietijd (s)' }, {
      en: 'Time before a new set-point takes effect (reviews: within a few seconds).',
      nl: 'Tijd voordat een nieuw vermogen ingaat (reviews: binnen een paar seconden).',
    }),
    num('sim_ramp_wps', 200, 10, 5000, { en: 'Ramp rate (W per second)', nl: 'Opregelsnelheid (W per seconde)' }, {
      en: 'How fast the power changes after the response delay.',
      nl: 'Hoe snel het vermogen daarna verandert.',
    }),
    num('sim_export_fee', 0, -0.5, 0.5, { en: 'Feed-in fee without net metering (€/kWh)', nl: 'Terugleverkosten zonder saldering (€/kWh)' }, {
      en: 'For the comparison without net metering (from 2027): export earns the market price incl. VAT minus this amount.',
      nl: 'Voor de vergelijking zonder saldering (vanaf 2027): teruglevering levert de marktprijs incl. btw op, min dit bedrag.',
    }, { step: 0.01 }),
    {
      id: 'sim_reset_stats',
      type: 'checkbox',
      label: { en: 'Clear simulation statistics', nl: 'Simulatie-statistieken wissen' },
      hint: { en: 'Tick and save to start the comparison again.', nl: 'Aanvinken en opslaan om de vergelijking opnieuw te beginnen.' },
      value: false,
    },
  ],
};

const BRANDS = {
  zendure: {
    name: { en: 'Zendure SolarFlow', nl: 'Zendure SolarFlow' },
    capacity: { value: 2.4, hint: { en: 'SolarFlow 2400 AC+: 2.4 kWh built in + 2.88 kWh per AB3000L; SolarFlow 800: 1.92 kWh per battery.', nl: 'SolarFlow 2400 AC+: 2,4 kWh ingebouwd + 2,88 kWh per AB3000L; SolarFlow 800: 1,92 kWh per accu.' } },
    connection: [],
  },
  marstek: {
    name: { en: 'Marstek Venus', nl: 'Marstek Venus' },
    capacity: { value: 5.12, hint: { en: 'Venus E: 5.12 kWh; Venus A/D: see the type plate.', nl: 'Venus E: 5,12 kWh; Venus A/D: zie het typeplaatje.' } },
    connection: [
      {
        id: 'marstek_profile',
        type: 'dropdown',
        label: { en: 'Model', nl: 'Model' },
        hint: { en: 'The register map differs per model and hardware version.', nl: 'De registerindeling verschilt per model en hardwareversie.' },
        value: 'e_v3',
        values: [
          { id: 'e_v3', label: { en: 'Venus E v3 (Ethernet)', nl: 'Venus E v3 (netwerkkabel)' } },
          { id: 'e_v12', label: { en: 'Venus E v1/v2 (RS485 bridge)', nl: 'Venus E v1/v2 (RS485-adapter)' } },
          { id: 'a', label: { en: 'Venus A', nl: 'Venus A' } },
          { id: 'd', label: { en: 'Venus D', nl: 'Venus D' } },
        ],
      },
      ...connectionModbus,
      invertPower,
    ],
  },
  simulator: {
    name: { en: 'Simulated battery (SolarFlow 2400 AC+)', nl: 'Gesimuleerde batterij (SolarFlow 2400 AC+)' },
    capacity: { value: 2.4, hint: { en: 'SolarFlow 2400 AC+: 2.4 kWh built in + 2.88 kWh per AB3000L.', nl: 'SolarFlow 2400 AC+: 2,4 kWh ingebouwd + 2,88 kWh per AB3000L.' } },
    connection: [],
    simulated: true,
  },
  anker: {
    name: { en: 'Anker SOLIX', nl: 'Anker SOLIX' },
    capacity: { value: 5, hint: { en: 'See the Anker app or the type plate (including expansion batteries).', nl: 'Zie de Anker-app of het typeplaatje (inclusief uitbreidingsaccu\'s).' } },
    connection: [...connectionModbus, invertPower],
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

for (const [id, brand] of Object.entries(BRANDS)) {
  const def = clone(base);
  def.name = brand.name;
  const connection = def.settings.find((g) => g.label.en === 'Connection');
  const ipIndex = connection.children.findIndex((c) => c.id === 'battery_ip');
  connection.children.splice(ipIndex + 1, 0, ...clone(brand.connection));
  const battery = def.settings.find((g) => g.label.en === 'Battery');
  Object.assign(battery.children.find((c) => c.id === 'capacity_kwh'), clone(brand.capacity));
  if (brand.simulated) {
    // no battery hardware: no IP address and no demo mode; not a battery for Homey Energy
    // measure_battery would be shown as the device's own battery (low-battery icon), not as a tile
    def.class = 'other';
    delete def.energy;
    def.settings = def.settings.filter((g) => g.label.en !== 'Mode');
    connection.children = connection.children.filter((c) => c.id !== 'battery_ip');
    def.settings.splice(1, 0, clone(simulation));
    const simCaps = { measure_power: 'measure_power.battery', measure_battery: 'battery_soc' };
    def.capabilities = def.capabilities.map((c) => simCaps[c] || c);
    def.capabilitiesOptions['measure_power.battery'] = {
      title: { en: 'Battery power (simulated)', nl: 'Batterijvermogen (gesimuleerd)' },
    };
    delete def.capabilitiesOptions.measure_power;
    def.capabilitiesOptions['measure_power.grid'] = { title: { en: 'Grid with battery', nl: 'Net met batterij' } };
  }

  const dir = path.join(root, 'drivers', id);
  fs.mkdirSync(path.join(dir, 'pair'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'driver.compose.json'), `${JSON.stringify(def, null, 2)}\n`);
  for (const view of ['configure.html', 'hw_token.html']) {
    fs.copyFileSync(path.join(__dirname, 'pair', view), path.join(dir, 'pair', view));
  }
  fs.copyFileSync(path.join(root, 'assets', 'icon.svg'), path.join(dir, 'assets', 'icon.svg'));
  for (const img of ['small.png', 'large.png', 'xlarge.png']) {
    const src = path.join(root, 'tools', 'images', `driver-${img}`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, 'assets', 'images', img));
  }
  console.log(`drivers/${id} generated`);
}
