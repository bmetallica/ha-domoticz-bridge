const axios = require('axios');
const configManager = require('../config');

class HaApiClient {
  getHeaders() {
    const config = configManager.getConfig();
    return {
      'Authorization': `Bearer ${config.ha.token}`,
      'Content-Type': 'application/json'
    };
  }

  async getDevices() {
    try {
      const config = configManager.getConfig();
      const response = await axios.get(`${config.ha.url}/api/states`, {
        headers: this.getHeaders()
      });
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error fetching HA devices:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Helper to get a specific entity state
  async getState(entityId) {
    try {
      const config = configManager.getConfig();
      const response = await axios.get(`${config.ha.url}/api/states/${entityId}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error(`Error fetching HA state for ${entityId}:`, error.message);
      return null;
    }
  }

  async callService(domain, service, data) {
    try {
      const config = configManager.getConfig();
      const response = await axios.post(
        `${config.ha.url}/api/services/${domain}/${service}`,
        data,
        { headers: this.getHeaders() }
      );
      return { success: true, data: response.data };
    } catch (error) {
      console.error(`Error calling HA service ${domain}.${service}:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new HaApiClient();
