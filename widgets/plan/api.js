'use strict';

module.exports = {
  async getPlan({ homey }) {
    const driver = homey.drivers.getDriver('zendure');
    const [device] = driver.getDevices();
    if (!device) return null;
    return device.getWidgetData();
  },
};
