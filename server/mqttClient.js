const mqtt = require('mqtt');
const configManager = require('./config');

class MqttClientManager {
  constructor() {
    this.client = null;
    this.connect();
  }

  connect() {
    const config = configManager.getConfig();
    if (!config.mqtt.broker) return;

    console.log(`[MQTT] Connecting to broker: ${config.mqtt.broker}`);
    
    const options = {};
    if (config.mqtt.username) options.username = config.mqtt.username;
    if (config.mqtt.password) options.password = config.mqtt.password;

    this.client = mqtt.connect(config.mqtt.broker, options);

    this.client.on('connect', () => {
      console.log('[MQTT] Connected to broker successfully.');
      // Subscribe to both Domoticz and HA topics
      this.client.subscribe(`${config.domoticz.topicOut}/#`);
      this.client.subscribe(`${config.ha.discoveryPrefix}/#`);
      // We also might want to listen to state changes if HA publishes them, but usually HA state changes are via websocket/API or specific stat_t
    });

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message.toString());
    });

    this.client.on('error', (err) => {
      console.error('[MQTT] Error:', err.message);
    });
  }

  reconnect() {
    if (this.client) {
      this.client.end();
    }
    this.connect();
  }

  handleMessage(topic, messageStr) {
    const syncManager = require('./syncManager'); // Lazy load to avoid circular deps if any
    syncManager.handleMqttMessage(topic, messageStr, this);
  }

  publish(topic, payload, options = {}) {
    if (this.client && this.client.connected) {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      this.client.publish(topic, payloadStr, options);
    } else {
      console.warn(`[MQTT] Cannot publish to ${topic}, not connected.`);
    }
  }
}

module.exports = new MqttClientManager();
