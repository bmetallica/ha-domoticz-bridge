const fs = require('fs');
const path = require('path');
const configManager = require('./config');
const mqttClient = require('./mqttClient');
const domoticzClient = require('./apiClients/domoticz');

const pairingsPath = path.join(__dirname, '..', 'pairings.json');

class PairingManager {
  constructor() {
    this.pairings = this.loadPairings();
  }

  isHaOriginPairing(pairing) {
    if (!pairing) return false;
    if (pairing.pairingSource) {
      return pairing.pairingSource === 'ha';
    }

    return !pairing.haEntityId.startsWith(`${pairing.haType}.domoticz_`);
  }

  isDomoticzOriginPairing(pairing) {
    return !this.isHaOriginPairing(pairing);
  }

  isAvailableState(value) {
    if (value === undefined || value === null) return false;
    return !['unknown', 'unavailable', 'none', 'null'].includes(value.toString().toLowerCase());
  }

  isKwhDevice(domoticzDevice) {
    return domoticzDevice.SubType === 'kWh' || domoticzDevice.Usage !== undefined;
  }

  sanitizeNumericValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'number') return value.toString();
    return value.toString().replace(/[^\d.,-]/g, '').replace(',', '.');
  }

  normalizeUnit(unit) {
    if (!unit) return '';

    return unit
      .toString()
      .trim()
      .replace(/Â/g, '')
      .replace(/°/g, '')
      .replace(/µ/g, 'u')
      .replace(/³/g, '3')
      .replace(/²/g, '2')
      .toLowerCase();
  }

  getNumericState(value) {
    const sanitized = this.sanitizeNumericValue(value);
    if (sanitized === '') return null;

    const parsed = parseFloat(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  isNumericState(value) {
    return this.getNumericState(value) !== null;
  }

  getHumidityStatus(value) {
    if (!Number.isFinite(value)) return '0';
    if (value < 40) return '2';
    if (value <= 70) return '1';
    return '3';
  }

  convertTemperatureToCelsius(value, unit) {
    if (!Number.isFinite(value)) return null;
    if (unit === 'f') {
      return (value - 32) * 5 / 9;
    }
    return value;
  }

  convertPressureToHpa(value, unit) {
    if (!Number.isFinite(value)) return null;

    if (unit === 'pa') return value / 100;
    if (unit === 'kpa') return value * 10;
    if (unit === 'bar') return value * 1000;
    if (unit === 'psi') return value * 68.9476;
    return value;
  }

  convertEnergyToWh(value, unit) {
    if (!Number.isFinite(value)) return null;

    if (unit === 'mwh') return Math.round(value * 1000000);
    if (unit === 'kwh') return Math.round(value * 1000);
    return Math.round(value);
  }

  convertVolumeToLiters(value, unit) {
    if (!Number.isFinite(value)) return null;

    if (unit === 'm3') return Math.round(value * 1000);
    if (unit === 'gal' || unit === 'gallons' || unit === 'usgal') return Math.round(value * 3.78541);
    if (unit === 'ft3') return Math.round(value * 28.3168);
    return Math.round(value);
  }

  getCompassDirection(degrees) {
    if (!Number.isFinite(degrees)) return 'N';
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const normalized = ((degrees % 360) + 360) % 360;
    return directions[Math.round(normalized / 22.5) % 16];
  }

  buildCustomSensorMapping(friendlyName, unit, initialValue) {
    const displayValue = initialValue === null || initialValue === undefined
      ? null
      : unit
        ? `${initialValue} ${unit}`
        : initialValue.toString();

    return {
      supported: true,
      creationMode: 'device',
      deviceType: 243,
      deviceSubType: 19,
      domoticzType: 'General',
      domoticzSubType: 'Text',
      name: friendlyName,
      initialValue: displayValue === null
        ? null
        : { nvalue: 0, svalue: displayValue }
    };
  }
  buildHaToDomoticzMapping(haEntity) {
    const domain = haEntity.entity_id.split('.')[0];
    const deviceClass = haEntity.attributes?.device_class;
    const unit = haEntity.attributes?.unit_of_measurement;
    const normalizedUnit = this.normalizeUnit(unit);
    const friendlyName = haEntity.attributes?.friendly_name || haEntity.entity_id;
    const numericState = this.getNumericState(haEntity.state);
    const normalizedState = haEntity.state?.toString().toLowerCase();

    if (domain === 'switch' || domain === 'input_boolean' || domain === 'light') {
      return {
        supported: true,
        creationMode: 'device',
        deviceType: 244,
        deviceSubType: 73,
        switchType: 0,
        domoticzType: 'Light/Switch',
        domoticzSubType: 'Switch',
        name: friendlyName,
        initialValue: this.isAvailableState(haEntity.state)
          ? { command: normalizedState === 'on' ? 'On' : 'Off' }
          : null
      };
    }

    if (domain === 'binary_sensor') {
      const switchType = deviceClass === 'motion'
        ? 8
        : (deviceClass === 'door' || deviceClass === 'window' || deviceClass === 'opening' ? 11 : 2);

      return {
        supported: true,
        creationMode: 'device',
        deviceType: 244,
        deviceSubType: 73,
        switchType,
        domoticzType: 'Light/Switch',
        domoticzSubType: 'Switch',
        name: friendlyName,
        initialValue: this.isAvailableState(haEntity.state)
          ? { command: normalizedState === 'on' ? 'On' : 'Off' }
          : null
      };
    }

    if (domain !== 'sensor' && domain !== 'number' && domain !== 'input_number') {
      return {
        supported: false,
        message: `HA domain ${domain} is not implemented yet for Domoticz export`
      };
    }

    if (deviceClass === 'temperature' || normalizedUnit === 'c' || normalizedUnit === 'f') {
      const tempValue = this.convertTemperatureToCelsius(numericState, normalizedUnit);
      return {
        supported: true,
        creationMode: 'virtualSensor',
        sensorType: 80,
        domoticzType: 'Temp',
        domoticzSubType: 'Virtual Temperature',
        name: friendlyName,
        initialValue: tempValue === null ? null : { nvalue: 0, svalue: tempValue.toString() }
      };
    }

    if (deviceClass === 'humidity' || normalizedUnit === '%') {
      return {
        supported: true,
        creationMode: 'virtualSensor',
        sensorType: 81,
        domoticzType: 'Humidity',
        domoticzSubType: 'Virtual Humidity',
        name: friendlyName,
        initialValue: numericState === null
          ? null
          : { nvalue: Math.round(numericState), svalue: this.getHumidityStatus(numericState) }
      };
    }

    if (deviceClass === 'pressure') {
      const pressureValue = this.convertPressureToHpa(numericState, normalizedUnit);
      return {
        supported: true,
        creationMode: 'device',
        deviceType: 243,
        deviceSubType: 26,
        domoticzType: 'General',
        domoticzSubType: 'Barometer',
        name: friendlyName,
        initialValue: pressureValue === null
          ? null
          : { nvalue: 0, svalue: `${Math.round(pressureValue)};5` }
      };
    }

    if (deviceClass === 'energy') {
      const energyWh = this.convertEnergyToWh(numericState, normalizedUnit);
      return {
        supported: true,
        creationMode: 'virtualSensor',
        sensorType: 113,
        switchType: 0,
        domoticzType: 'General',
        domoticzSubType: 'Energy',
        name: friendlyName,
        initialValue: energyWh === null ? null : { nvalue: 0, svalue: energyWh.toString() }
      };
    }

    if (deviceClass === 'gas') {
      const gasLiters = this.convertVolumeToLiters(numericState, normalizedUnit);
      return {
        supported: true,
        creationMode: 'virtualSensor',
        sensorType: 113,
        switchType: 1,
        domoticzType: 'General',
        domoticzSubType: 'Gas',
        name: friendlyName,
        initialValue: gasLiters === null ? null : { nvalue: 0, svalue: gasLiters.toString() }
      };
    }

    if (deviceClass === 'water') {
      const waterLiters = this.convertVolumeToLiters(numericState, normalizedUnit);
      return {
        supported: true,
        creationMode: 'virtualSensor',
        sensorType: 113,
        switchType: 2,
        domoticzType: 'General',
        domoticzSubType: 'Water',
        name: friendlyName,
        initialValue: waterLiters === null ? null : { nvalue: 0, svalue: waterLiters.toString() }
      };
    }

    if (deviceClass === 'carbon_dioxide' || deviceClass === 'co2') {
      return {
        supported: true,
        creationMode: 'virtualSensor',
        sensorType: 249,
        domoticzType: 'Air Quality',
        domoticzSubType: 'Air Quality',
        name: friendlyName,
        initialValue: numericState === null ? null : { nvalue: Math.round(numericState), svalue: '0' }
      };
    }

    if (deviceClass === 'voltage') {
      return {
        supported: true,
        creationMode: 'device',
        deviceType: 243,
        deviceSubType: 8,
        domoticzType: 'General',
        domoticzSubType: 'Voltage',
        name: friendlyName,
        initialValue: numericState === null ? null : { nvalue: 0, svalue: numericState.toString() }
      };
    }

    if (deviceClass === 'current') {
      return {
        supported: true,
        creationMode: 'device',
        deviceType: 243,
        deviceSubType: 23,
        domoticzType: 'General',
        domoticzSubType: 'Current (Single)',
        name: friendlyName,
        initialValue: numericState === null ? null : { nvalue: 0, svalue: numericState.toString() }
      };
    }

    if (deviceClass === 'illuminance') {
      return {
        supported: true,
        creationMode: 'device',
        deviceType: 246,
        deviceSubType: 1,
        domoticzType: 'Lux',
        domoticzSubType: 'Lux',
        name: friendlyName,
        initialValue: numericState === null ? null : { nvalue: 0, svalue: numericState.toString() }
      };
    }

    if (deviceClass === 'distance') {
      return {
        supported: true,
        creationMode: 'device',
        deviceType: 243,
        deviceSubType: 27,
        domoticzType: 'General',
        domoticzSubType: 'Distance',
        name: friendlyName,
        initialValue: numericState === null ? null : { nvalue: 0, svalue: numericState.toString() }
      };
    }

    if (deviceClass === 'sound_pressure') {
      return {
        supported: true,
        creationMode: 'device',
        deviceType: 243,
        deviceSubType: 24,
        domoticzType: 'General',
        domoticzSubType: 'Sound Level',
        name: friendlyName,
        initialValue: numericState === null ? null : { nvalue: 0, svalue: numericState.toString() }
      };
    }

    if (deviceClass === 'uv') {
      return {
        supported: true,
        creationMode: 'virtualSensor',
        sensorType: 87,
        domoticzType: 'UV',
        domoticzSubType: 'UV',
        name: friendlyName,
        initialValue: numericState === null ? null : { nvalue: 0, svalue: `${numericState};0` }
      };
    }

    if (deviceClass === 'wind_speed') {
      return {
        supported: true,
        creationMode: 'virtualSensor',
        sensorType: 86,
        domoticzType: 'Wind',
        domoticzSubType: 'Wind',
        name: friendlyName,
        initialValue: numericState === null
          ? null
          : { nvalue: 0, svalue: `0;N;${Math.round(numericState * 10)};${Math.round(numericState * 10)};0;0` }
      };
    }

    if (deviceClass === 'battery' || deviceClass === 'moisture') {
      return {
        supported: true,
        creationMode: 'virtualSensor',
        sensorType: 2,
        domoticzType: 'General',
        domoticzSubType: 'Percentage',
        name: friendlyName,
        initialValue: numericState === null ? null : { nvalue: 0, svalue: numericState.toString() }
      };
    }

    if (numericState !== null) {
      if (deviceClass === 'power' || normalizedUnit === 'w' || normalizedUnit === 'kw') {
        const watts = normalizedUnit === 'kw' ? numericState * 1000 : numericState;
        return {
          supported: true,
          creationMode: 'virtualSensor',
          sensorType: 248,
          domoticzType: 'Usage',
          domoticzSubType: 'Electric',
          name: friendlyName,
          initialValue: { nvalue: 0, svalue: watts.toString() }
        };
      }

      return this.buildCustomSensorMapping(friendlyName, unit || 'value', numericState);
    }

    if (this.isAvailableState(haEntity.state)) {
      return {
        supported: true,
        creationMode: 'device',
        deviceType: 243,
        deviceSubType: 19,
        domoticzType: 'General',
        domoticzSubType: 'Text',
        name: friendlyName,
        initialValue: { nvalue: 0, svalue: haEntity.state.toString() }
      };
    }

    return {
      supported: false,
      message: `HA sensor ${haEntity.entity_id} with device_class ${deviceClass || 'n/a'} and unit ${unit || 'n/a'} is not implemented yet`
    };
  }

  publishDiscovery(topic, payload) {
    mqttClient.publish(topic, payload, { retain: true });
  }

  publishInitialState(topic, value) {
    if (value === '') return;
    setTimeout(() => {
      mqttClient.publish(topic, value.toString(), { retain: true });
    }, 500);
  }

  loadPairings() {
    if (fs.existsSync(pairingsPath)) {
      try {
        const data = fs.readFileSync(pairingsPath, 'utf8');
        return JSON.parse(data);
      } catch (e) {
        console.error('Error reading pairings.json:', e);
        return [];
      }
    }
    return [];
  }

  savePairings() {
    fs.writeFileSync(pairingsPath, JSON.stringify(this.pairings, null, 2));
  }

  getPairingByDomoticzIdx(idx) {
    return this.pairings.find(p => p.domoticzIdx == idx);
  }

  getPairingByHaEntityId(entityId) {
    return this.pairings.find(p => p.haEntityId === entityId);
  }

  getPairings() {
    return this.pairings;
  }

  unpairDomoticz(idx) {
    const pairing = this.getPairingByDomoticzIdx(idx);
    if (!pairing) return { success: false, message: 'Pairing not found' };

    const config = configManager.getConfig();
    const objectId = `domoticz_${idx}`;
    const discoveryTopic = `${config.ha.discoveryPrefix}/${pairing.haType}/domoticz/${objectId}/config`;
    
    // Publish empty message to delete from HA autodiscovery
    mqttClient.publish(discoveryTopic, '', { retain: true });
    if (pairing.domoticzSubType === 'kWh') {
      const energyDiscoveryTopic = `${config.ha.discoveryPrefix}/sensor/domoticz/${objectId}_energy/config`;
      mqttClient.publish(energyDiscoveryTopic, '', { retain: true });
    }

    this.pairings = this.pairings.filter(p => p.domoticzIdx != idx);
    this.savePairings();

    return { success: true, message: 'Unpaired successfully' };
  }

  // Auto-Discovery payload generation for HA
  pairDomoticzToHa(domoticzDevice) {
    const config = configManager.getConfig();
    const idx = domoticzDevice.idx;
    const isKwhDevice = this.isKwhDevice(domoticzDevice);
    
    // 1. Determine HA Type based on Domoticz Type
    let haType = 'sensor';
    let deviceClass = null;
    
    if (domoticzDevice.Type === 'Light/Switch' || domoticzDevice.SwitchType) {
      haType = 'switch'; // Or light
    } else if (domoticzDevice.Type === 'Temp' || domoticzDevice.Type === 'Temp + Humidity') {
      haType = 'sensor';
      deviceClass = 'temperature';
    } else if (isKwhDevice) {
      haType = 'sensor';
      deviceClass = 'power';
    } else if (domoticzDevice.Type.includes('Usage') || domoticzDevice.Type.includes('Energy') || domoticzDevice.Type.includes('P1')) {
      haType = 'sensor';
      deviceClass = 'energy';
    } else if (domoticzDevice.SubType === 'Watt' || domoticzDevice.SubType === 'Electric') {
      haType = 'sensor';
      deviceClass = 'power';
    } else {
      haType = 'sensor'; // Fallback
    }

    const objectId = `domoticz_${idx}`;
    const haEntityId = `${haType}.${objectId}`;
    const discoveryTopic = `${config.ha.discoveryPrefix}/${haType}/domoticz/${objectId}/config`;

    // 2. Build Payload
    const payload = {
      name: domoticzDevice.Name,
      unique_id: objectId,
      state_topic: isKwhDevice
        ? `${config.ha.discoveryPrefix}/bridge/state/${idx}/power`
        : `${config.ha.discoveryPrefix}/bridge/state/${idx}`,
      device: {
        identifiers: [`domoticz_${idx}`],
        name: domoticzDevice.Name,
        manufacturer: 'Domoticz Bridge'
      }
    };

    if (haType === 'switch') {
      payload.command_topic = `${config.ha.discoveryPrefix}/bridge/command/${idx}`;
    }

    if (deviceClass) {
      payload.device_class = deviceClass;
      if (deviceClass === 'temperature') payload.unit_of_measurement = '°C';
      if (deviceClass === 'power') {
        payload.unit_of_measurement = 'W';
        payload.state_class = 'measurement';
      }
      if (deviceClass === 'energy') {
        payload.unit_of_measurement = 'kWh';
        payload.state_class = 'total_increasing';
      }
    }

    // 3. Publish to MQTT for Autodiscovery with retain: true
    this.publishDiscovery(discoveryTopic, payload);

    if (isKwhDevice) {
      const energyObjectId = `${objectId}_energy`;
      const energyDiscoveryTopic = `${config.ha.discoveryPrefix}/sensor/domoticz/${energyObjectId}/config`;
      const energyPayload = {
        name: `${domoticzDevice.Name} Energy`,
        unique_id: energyObjectId,
        state_topic: `${config.ha.discoveryPrefix}/bridge/state/${idx}/energy`,
        device_class: 'energy',
        unit_of_measurement: 'kWh',
        state_class: 'total_increasing',
        device: payload.device
      };
      this.publishDiscovery(energyDiscoveryTopic, energyPayload);
    }

    // 4. Publish initial state
    let initialState = '';
    if (haType === 'switch' || haType === 'light') {
      initialState = domoticzDevice.Status === 'On' ? 'ON' : 'OFF';
    } else if (isKwhDevice) {
      initialState = this.sanitizeNumericValue(domoticzDevice.Usage);
    } else if (haType === 'sensor') {
      let rawVal = domoticzDevice.Temp !== undefined ? domoticzDevice.Temp : domoticzDevice.Data;
      initialState = this.sanitizeNumericValue(rawVal);
    }
    
    this.publishInitialState(payload.state_topic, initialState);

    if (isKwhDevice) {
      const initialEnergy = this.sanitizeNumericValue(domoticzDevice.Data);
      this.publishInitialState(`${config.ha.discoveryPrefix}/bridge/state/${idx}/energy`, initialEnergy);
    }

    // 5. Save Pairing
    this.addPairing({
      domoticzIdx: idx,
      haEntityId: haEntityId,
      haType: haType,
      pairingSource: 'domoticz',
      domoticzType: domoticzDevice.Type,
      domoticzSubType: domoticzDevice.SubType,
      name: domoticzDevice.Name
    });

    return { success: true, message: `Created discovery payload for ${haEntityId}` };
  }

  async restoreDiscoveryForPairings() {
    for (const pairing of [...this.pairings]) {
      if (!this.isDomoticzOriginPairing(pairing)) {
        continue;
      }

      const device = await domoticzClient.getDevice(pairing.domoticzIdx);
      if (!device) continue;
      this.pairDomoticzToHa(device);
    }
  }

  async pairHaToDomoticz(haEntity) {
    const entityId = haEntity.entity_id;

    const mapping = this.buildHaToDomoticzMapping(haEntity);
    if (!mapping.supported) {
      return { success: false, message: mapping.message };
    }

    const bridgeHardware = await domoticzClient.ensureBridgeHardware();
    const creationResult = mapping.creationMode === 'device'
      ? await domoticzClient.createDevice(bridgeHardware.idx, mapping.name, mapping.deviceType, mapping.deviceSubType, mapping.switchType, mapping.options)
      : await domoticzClient.createVirtualSensor(bridgeHardware.idx, mapping.name, mapping.sensorType, { switchType: mapping.switchType, options: mapping.options });
    if (!creationResult.success) {
      return { success: false, message: creationResult.error };
    }

    const domoticzDevice = creationResult.device;

    if (mapping.initialValue) {
      const updateResult = mapping.initialValue.command
        ? await domoticzClient.switchLight(domoticzDevice.idx, mapping.initialValue.command)
        : await domoticzClient.updateDevice(domoticzDevice.idx, mapping.initialValue.nvalue, mapping.initialValue.svalue);
      if (!updateResult.success) {
        return { success: false, message: updateResult.error };
      }
    }

    this.addPairing({
      domoticzIdx: domoticzDevice.idx,
      haEntityId: entityId,
      haType: entityId.split('.')[0],
      pairingSource: 'ha',
      domoticzType: mapping.domoticzType,
      domoticzSubType: mapping.domoticzSubType,
      name: mapping.name
    });

    return { success: true, message: `Created Domoticz device with idx ${domoticzDevice.idx}` };
  }

  addPairing(pairing) {
    // Remove existing if any
    this.pairings = this.pairings.filter(p => p.domoticzIdx !== pairing.domoticzIdx && p.haEntityId !== pairing.haEntityId);
    this.pairings.push(pairing);
    this.savePairings();
  }
}

module.exports = new PairingManager();
