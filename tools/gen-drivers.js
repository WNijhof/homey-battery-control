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
