const pairingManager = require('./pairingManager');
const configManager = require('./config');
const haClient = require('./apiClients/ha');

class SyncManager {
  constructor() {
    // Basic debounce / loop prevention mechanism
    this.lastUpdates = {};
  }

  isHaOriginPairing(pairing) {
    return pairingManager.isHaOriginPairing(pairing);
  }

  sanitizeNumericValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number') return value.toString();
    return value.toString().replace(/[^\d.,-]/g, '').replace(',', '.');
  }

  // Handle incoming MQTT messages
  handleMqttMessage(topic, payloadStr, mqttClient) {
    const config = configManager.getConfig();

    try {
      // console.log(`[MQTT] Incoming on ${topic}: ${payloadStr}`);
      // 1. Message from Domoticz -> Translate to HA
      if (topic.startsWith(config.domoticz.topicOut)) {
        console.log(`[Domoticz->HA] Payload received: ${payloadStr}`);
        const domoticzPayload = JSON.parse(payloadStr);
        this.syncDomoticzToHa(domoticzPayload, mqttClient);
      }
      
      // 2. Command from HA -> Translate to Domoticz
      else if (topic.startsWith(`${config.ha.discoveryPrefix}/bridge/command/`)) {
        // e.g. homeassistant/bridge/command/123
        const parts = topic.split('/');
        const idx = parts[parts.length - 1];
        this.syncHaToDomoticz(idx, payloadStr, mqttClient);
      }
    } catch (e) {
      console.error('[SyncManager] Error handling message:', e.message);
    }
  }

  syncDomoticzToHa(domoticzPayload, mqttClient) {
    const idx = domoticzPayload.idx;
    if (!idx) return;

    // Check if paired
    const pairing = pairingManager.getPairingByDomoticzIdx(idx);
    if (!pairing) return;

    // Loop prevention
    const now = Date.now();
    const lastUpdate = this.lastUpdates[`domoticz_${idx}`] || 0;
    if (now - lastUpdate < 500) {
      // console.log(`[Sync] Ignored rapid update for Domoticz idx ${idx}`);
      return;
    }
    this.lastUpdates[`domoticz_${idx}`] = now;

    const config = configManager.getConfig();
    const stateTopic = `${config.ha.discoveryPrefix}/bridge/state/${idx}`;
    let haState = '';
    const subtype = domoticzPayload.SubType || domoticzPayload.stype;
    const isKwhDevice = pairing.domoticzSubType === 'kWh' || subtype === 'kWh' || domoticzPayload.Usage !== undefined;

    if (pairing.haType === 'switch' || pairing.haType === 'light') {
      haState = domoticzPayload.nvalue === 1 ? 'ON' : 'OFF';

      if (this.isHaOriginPairing(pairing)) {
        const service = haState === 'ON' ? 'turn_on' : 'turn_off';
        haClient.callService(pairing.haType, service, { entity_id: pairing.haEntityId });
        return;
      }
    } else if (isKwhDevice) {
      const powerSource = domoticzPayload.Usage !== undefined ? domoticzPayload.Usage : domoticzPayload.nvalue;
      const energySource = domoticzPayload.Data !== undefined ? domoticzPayload.Data : domoticzPayload.svalue;
      const powerState = this.sanitizeNumericValue(powerSource);
      const energyState = this.sanitizeNumericValue(energySource);

      if (powerState !== '') {
        mqttClient.publish(`${config.ha.discoveryPrefix}/bridge/state/${idx}/power`, powerState, { retain: true });
        mqttClient.publish(stateTopic, powerState, { retain: true });
      }

      if (energyState !== '') {
        mqttClient.publish(`${config.ha.discoveryPrefix}/bridge/state/${idx}/energy`, energyState, { retain: true });
      }

      return;
    } else if (pairing.haType === 'sensor') {
      // Temperature or Utility
      haState = domoticzPayload.svalue1 !== undefined ? domoticzPayload.svalue1 : domoticzPayload.svalue;
      haState = this.sanitizeNumericValue(haState);
    }

    if (haState !== '') {
      mqttClient.publish(stateTopic, haState.toString(), { retain: true });
    }
  }

  syncHaToDomoticz(idx, haPayload, mqttClient) {
    const config = configManager.getConfig();
    
    // Check if paired
    const pairing = pairingManager.getPairingByDomoticzIdx(idx);
    if (!pairing) return;

    // Loop prevention
    const now = Date.now();
    const lastUpdate = this.lastUpdates[`ha_${idx}`] || 0;
    if (now - lastUpdate < 500) {
      // console.log(`[Sync] Ignored rapid update for HA idx ${idx}`);
      return;
    }
    this.lastUpdates[`ha_${idx}`] = now;

    let domoticzCommand = {};

    if (pairing.haType === 'switch' || pairing.haType === 'light') {
      const state = haPayload.toString().toUpperCase();
      // For Domoticz, usually we send to domoticz/in: { "command": "switchlight", "idx": 123, "switchcmd": "On" }
      domoticzCommand = {
        command: 'switchlight',
        idx: parseInt(idx),
        switchcmd: state === 'ON' ? 'On' : 'Off'
      };
    }

    if (Object.keys(domoticzCommand).length > 0) {
      // console.log(`[Sync] HA -> Domoticz: idx ${idx} -> cmd ${domoticzCommand.switchcmd}`);
      mqttClient.publish(config.domoticz.topicIn, JSON.stringify(domoticzCommand));
    }
  }
}

module.exports = new SyncManager();
