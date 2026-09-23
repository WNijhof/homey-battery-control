'use strict';

module.exports = {
  async getPlan({ homey }) {
    const [device] = homey.app.batteries();
    if (!device) return null;
    return device.getWidgetData();
  },
};
