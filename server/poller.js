const configManager = require('./config');
const pairingManager = require('./pairingManager');
const mqttClient = require('./mqttClient');
const domoticzClient = require('./apiClients/domoticz');
const haClient = require('./apiClients/ha');

class Poller {
  constructor() {
    this.interval = null;
    this.pollIntervalMs = 10000; // 10 seconds
    this.lastHaStates = {};
  }

  sanitizeNumericValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number') return value.toString();
    return value.toString().replace(/[^\d.,-]/g, '').replace(',', '.');
  }

  start() {
    console.log(`[Poller] Starting API poller (every ${this.pollIntervalMs / 1000}s)`);
    // Initial poll after 5 seconds
    setTimeout(() => this.poll(), 5000);
    this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async poll() {
    const pairings = pairingManager.getPairings();
    if (pairings.length === 0) return;

    const config = configManager.getConfig();
    if (!config.domoticz.url) return;

    for (const pairing of pairings) {
      try {
        if (pairingManager.isHaOriginPairing(pairing)) {
          await this.syncHaToDomoticz(pairing);
          continue;
        }

        const device = await domoticzClient.getDevice(pairing.domoticzIdx);
        if (device) {
          this.publishState(pairing, device, config);
        }
      } catch (err) {
        // Silently ignore individual device poll failures
      }
    }
  }

  async syncHaToDomoticz(pairing) {
    const state = await haClient.getState(pairing.haEntityId);
    if (!state || state.state === undefined || state.state === null) {
      return;
    }

    const stateWithEntityId = {
      ...state,
      entity_id: state.entity_id || pairing.haEntityId
    };
    const mapping = pairingManager.buildHaToDomoticzMapping(stateWithEntityId);
    if (!mapping.supported || !mapping.initialValue) {
      return;
    }

    const stateSignature = JSON.stringify(mapping.initialValue);
    if (this.lastHaStates[pairing.domoticzIdx] === stateSignature) {
      return;
    }

    this.lastHaStates[pairing.domoticzIdx] = stateSignature;

    if (mapping.initialValue.command) {
      await domoticzClient.switchLight(pairing.domoticzIdx, mapping.initialValue.command);
      return;
    }

    await domoticzClient.updateDevice(pairing.domoticzIdx, mapping.initialValue.nvalue, mapping.initialValue.svalue);
  }

  publishState(pairing, device, config) {
    const idx = pairing.domoticzIdx;
    const prefix = config.ha.discoveryPrefix;
    const isKwhDevice = pairing.domoticzSubType === 'kWh' || device.SubType === 'kWh' || device.Usage !== undefined;

    if (pairing.haType === 'switch' || pairing.haType === 'light') {
      const state = device.Status === 'On' ? 'ON' : 'OFF';
      mqttClient.publish(`${prefix}/bridge/state/${idx}`, state, { retain: true });
    } else if (isKwhDevice) {
      // kWh devices have both Usage (Watt) and Data (kWh)
      // Publish power value
      if (device.Usage) {
        const watts = this.sanitizeNumericValue(device.Usage);
        mqttClient.publish(`${prefix}/bridge/state/${idx}`, watts, { retain: true });
        mqttClient.publish(`${prefix}/bridge/state/${idx}/power`, watts, { retain: true });
      }
      // Publish energy value
      if (device.Data) {
        const kwh = this.sanitizeNumericValue(device.Data);
        mqttClient.publish(`${prefix}/bridge/state/${idx}/energy`, kwh, { retain: true });
      }
    } else if (pairing.haType === 'sensor') {
      // Generic sensor - use Data field
      let val = device.Temp !== undefined ? device.Temp.toString() : device.Data;
      val = this.sanitizeNumericValue(val);
      mqttClient.publish(`${prefix}/bridge/state/${idx}`, val, { retain: true });
    }
  }
}

module.exports = new Poller();
