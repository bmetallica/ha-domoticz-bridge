const axios = require('axios');
const configManager = require('../config');

class DomoticzApiClient {
  encodeOptions(options) {
    if (!options || typeof options !== 'object' || Object.keys(options).length === 0) {
      return null;
    }

    const rawOptions = Object.entries(options)
      .map(([key, value]) => `${key}:${value}`)
      .join(';');

    return Buffer.from(rawOptions).toString('base64');
  }

  async sendCommand(params) {
    const config = configManager.getConfig();
    const response = await axios.get(`${config.domoticz.url}/json.htm`, {
      params: {
        type: 'command',
        ...params
      },
      ...this.getAuthParams()
    });

    return response.data;
  }

  getAuthParams() {
    const config = configManager.getConfig();
    // Domoticz usually accepts basic auth via URL or Base64 header
    return {
      auth: {
        username: config.domoticz.username,
        password: config.domoticz.password
      }
    };
  }

  async getDevices() {
    try {
      const config = configManager.getConfig();
      const response = await axios.get(`${config.domoticz.url}/json.htm?type=command&param=getdevices&filter=all&used=true`, {
        ...this.getAuthParams()
      });
      if (response.data && response.data.result) {
        return { success: true, data: response.data.result };
      }
      return { success: true, data: [] };
    } catch (error) {
      console.error('Error fetching Domoticz devices:', error.message);
      return { success: false, error: error.message };
    }
  }

  async getHardware() {
    try {
      const data = await this.sendCommand({ param: 'gethardware' });
      return Array.isArray(data.result) ? data.result : [];
    } catch (error) {
      console.error('Error fetching Domoticz hardware:', error.message);
      return [];
    }
  }

  async getDevice(idx) {
    try {
      const config = configManager.getConfig();
      const response = await axios.get(`${config.domoticz.url}/json.htm?type=command&param=getdevices&rid=${idx}`, {
        ...this.getAuthParams()
      });
      if (response.data && response.data.result && response.data.result.length > 0) {
        return response.data.result[0];
      }
      return null;
    } catch (error) {
      console.error(`Error fetching Domoticz device ${idx}:`, error.message);
      return null;
    }
  }

  async findDeviceByName(name, hardwareIdx = null) {
    const result = await this.getDevices();
    if (!result.success || !Array.isArray(result.data)) {
      return null;
    }

    return result.data.find((device) => {
      if (device.Name !== name) {
        return false;
      }

      if (!hardwareIdx) {
        return true;
      }

      return device.HardwareID?.toString() === hardwareIdx.toString();
    }) || null;
  }

  async ensureBridgeHardware(name = 'HA Bridge') {
    const hardware = await this.getHardware();
    const existing = hardware.find((entry) => entry.Type === 15 && entry.Name === name);
    if (existing) {
      return existing;
    }

    const createResult = await this.sendCommand({
      param: 'addhardware',
      htype: 15,
      port: 1,
      name,
      enabled: true
    });

    if (createResult.status !== 'OK') {
      throw new Error(createResult.message || 'Failed to create Domoticz bridge hardware');
    }

    const updatedHardware = await this.getHardware();
    const created = updatedHardware.find((entry) => entry.Type === 15 && entry.Name === name);
    if (!created) {
      throw new Error('Domoticz bridge hardware was created but could not be reloaded');
    }

    return created;
  }

  // Create a virtual device (Dummy hardware needs to exist, we might need to find it or create it first)
  // For simplicity, we assume a Dummy hardware index is provided or found
  async createVirtualSensor(hardwareIdx, sensorName, sensorType, finalizeOptions = {}) {
    try {
      const result = await this.sendCommand({
        param: 'createvirtualsensor',
        idx: hardwareIdx,
        sensorname: sensorName,
        sensortype: sensorType
      });

      if (result.status !== 'OK') {
        return { success: false, error: result.message || 'Failed to create virtual sensor' };
      }

      let device = await this.findDeviceByName(sensorName, hardwareIdx);
      if (!device) {
        return { success: false, error: 'Virtual sensor created but device lookup failed' };
      }

      const setUsedParams = {
        param: 'setused',
        idx: device.idx,
        name: sensorName,
        used: true
      };

      if (finalizeOptions.switchType !== undefined && finalizeOptions.switchType !== null) {
        setUsedParams.switchtype = finalizeOptions.switchType;
      }

      const encodedOptions = this.encodeOptions(finalizeOptions.options);
      if (encodedOptions) {
        setUsedParams.options = encodedOptions;
      }

      if (Object.keys(setUsedParams).length > 4) {
        const setUsedResult = await this.sendCommand(setUsedParams);
        if (setUsedResult.status !== 'OK') {
          return { success: false, error: setUsedResult.message || 'Failed to finalize virtual sensor options' };
        }

        device = await this.getDevice(device.idx);
      }

      return { success: true, device };
    } catch (error) {
      console.error('Error creating Domoticz virtual device:', error.message);
      return { success: false, error: error.message };
    }
  }

  async createDevice(hardwareIdx, sensorName, deviceType, deviceSubType, switchType = null, options = null) {
    try {
      const result = await this.sendCommand({
        param: 'createdevice',
        idx: hardwareIdx,
        sensorname: sensorName,
        devicetype: deviceType,
        devicesubtype: deviceSubType
      });

      if (result.status !== 'OK') {
        return { success: false, error: result.message || 'Failed to create device' };
      }

      const createdIdx = result.idx;
      const encodedOptions = this.encodeOptions(options);
      if (createdIdx && (switchType !== null || encodedOptions)) {
        const setUsedParams = {
          param: 'setused',
          idx: createdIdx,
          name: sensorName,
          used: true
        };

        if (switchType !== null) {
          setUsedParams.switchtype = switchType;
        }

        if (encodedOptions) {
          setUsedParams.options = encodedOptions;
        }

        const setUsedResult = await this.sendCommand(setUsedParams);

        if (setUsedResult.status !== 'OK') {
          return { success: false, error: setUsedResult.message || 'Failed to finalize device switch type' };
        }
      }

      const device = createdIdx ? await this.getDevice(createdIdx) : await this.findDeviceByName(sensorName, hardwareIdx);
      if (!device) {
        return { success: false, error: 'Device created but lookup failed' };
      }

      return { success: true, device };
    } catch (error) {
      console.error('Error creating Domoticz device:', error.message);
      return { success: false, error: error.message };
    }
  }

  async updateDevice(idx, nvalue, svalue) {
    try {
      const result = await this.sendCommand({
        param: 'udevice',
        idx,
        nvalue,
        svalue
      });

      return result.status === 'OK'
        ? { success: true }
        : { success: false, error: result.message || 'Failed to update Domoticz device' };
    } catch (error) {
      console.error(`Error updating Domoticz device ${idx}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async switchLight(idx, command) {
    try {
      const result = await this.sendCommand({
        param: 'switchlight',
        idx,
        switchcmd: command
      });

      return result.status === 'OK'
        ? { success: true }
        : { success: false, error: result.message || 'Failed to switch Domoticz device' };
    } catch (error) {
      console.error(`Error switching Domoticz device ${idx}:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new DomoticzApiClient();
