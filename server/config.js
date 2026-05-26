const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'config.json');

const defaultConfig = {
  mqtt: {
    broker: 'mqtt://192.168.1.10',
    username: '',
    password: ''
  },
  ha: {
    url: 'http://192.168.1.20:8123',
    token: 'DEIN_LONG_LIVED_ACCESS_TOKEN',
    discoveryPrefix: 'homeassistant'
  },
  domoticz: {
    url: 'http://192.168.1.30',
    username: 'DEIN_BENUTZER',
    password: 'DEIN_PASSWORT',
    topicIn: 'domoticz/in',
    topicOut: 'domoticz/out'
  }
};

class ConfigManager {
  constructor() {
    this.config = this.loadConfig();
  }

  loadConfig() {
    if (fs.existsSync(configPath)) {
      try {
        const data = fs.readFileSync(configPath, 'utf8');
        return { ...defaultConfig, ...JSON.parse(data) };
      } catch (e) {
        console.error('Error reading config.json, using defaults:', e);
        return defaultConfig;
      }
    }
    this.saveConfig(defaultConfig);
    return defaultConfig;
  }

  saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }

  getConfig() {
    return this.config;
  }
}

module.exports = new ConfigManager();
