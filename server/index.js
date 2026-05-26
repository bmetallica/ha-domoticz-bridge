const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const configManager = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- API Endpoints ---

const haClient = require('./apiClients/ha');
const domoticzClient = require('./apiClients/domoticz');
const mqttClient = require('./mqttClient'); // this will initialize connection
const poller = require('./poller');

// Get Configuration
app.get('/api/config', (req, res) => {
  res.json(configManager.getConfig());
});

// Update Configuration
app.post('/api/config', (req, res) => {
  try {
    configManager.saveConfig(req.body);
    mqttClient.reconnect();
    res.json({ success: true, message: 'Configuration saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get HA Devices
app.get('/api/ha/devices', async (req, res) => {
  const devices = await haClient.getDevices();
  res.json(devices);
});

const pairingManager = require('./pairingManager');

pairingManager.restoreDiscoveryForPairings().catch((err) => {
  console.error('[Bridge] Failed to restore MQTT discovery for pairings:', err.message);
});

poller.start();

// Get Domoticz Devices
app.get('/api/domoticz/devices', async (req, res) => {
  const devices = await domoticzClient.getDevices();
  res.json(devices);
});

// Pair Domoticz Device to HA
app.post('/api/pair/to-ha', (req, res) => {
  const { device } = req.body;
  if (!device) return res.status(400).json({ success: false, message: 'Missing device' });
  
  const result = pairingManager.pairDomoticzToHa(device);
  res.json(result);
});

// Get all pairings
app.get('/api/pairings', (req, res) => {
  res.json(pairingManager.getPairings());
});

// Unpair Domoticz Device
app.post('/api/unpair', (req, res) => {
  const { idx } = req.body;
  if (!idx) return res.status(400).json({ success: false, message: 'Missing idx' });

  const result = pairingManager.unpairDomoticz(idx);
  res.json(result);
});

// Pair HA Entity to Domoticz
app.post('/api/pair/to-domoticz', async (req, res) => {
  const { entity } = req.body;
  if (!entity) return res.status(400).json({ success: false, message: 'Missing entity' });

  const result = await pairingManager.pairHaToDomoticz(entity);
  res.json(result);
});

// Start server
app.listen(PORT, () => {
  console.log(`HA-Domoticz Bridge UI running on http://localhost:${PORT}`);
});
