const { createApp } = Vue;

createApp({
  data() {
    return {
      currentTab: 'dashboard',
      config: {
        mqtt: { broker: '', username: '', password: '' },
        ha: { url: '', token: '', discoveryPrefix: '' },
        domoticz: { url: '', username: '', password: '', topicIn: '', topicOut: '' }
      },
      saveMessage: '',
      domoticzDevices: [],
      haDevices: [],
      pairings: [],
      domoticzTypeFilter: 'all',
      loading: false
    };
  },
  mounted() {
    this.fetchConfig();
  },
  watch: {
    currentTab(newVal) {
      if ((newVal === 'dashboard' || newVal === 'paired') && this.domoticzDevices.length === 0) {
        this.fetchDevices();
      }
    }
  },
  computed: {
    domoticzTypeOptions() {
      return [...new Set(this.domoticzDevices.map(device => device.Type || 'Other'))].sort((left, right) => {
        return left.localeCompare(right);
      });
    },
    groupedDomoticzDevices() {
      // Filter out already paired devices
      const pairedIdxs = this.pairings.map(p => p.domoticzIdx.toString());
      const unpaired = this.domoticzDevices.filter((device) => {
        if (pairedIdxs.includes(device.idx.toString())) {
          return false;
        }

        if (this.domoticzTypeFilter === 'all') {
          return true;
        }

        return (device.Type || 'Other') === this.domoticzTypeFilter;
      });
      
      const groups = {};
      for (const dev of unpaired) {
        const type = dev.Type || 'Other';
        if (!groups[type]) groups[type] = [];
        groups[type].push(dev);
      }
      return groups;
    },
    groupedHaDevices() {
      const pairedIds = this.pairings.map(p => p.haEntityId);
      const unpaired = this.haDevices.filter(d => !pairedIds.includes(d.entity_id));
      
      const groups = {};
      for (const dev of unpaired) {
        const domain = dev.entity_id.split('.')[0];
        if (!groups[domain]) groups[domain] = [];
        groups[domain].push(dev);
      }
      return groups;
    }
  },
  methods: {
    async fetchConfig() {
      try {
        const res = await axios.get('/api/config');
        if (res.data) {
          this.config = res.data;
        }
      } catch (err) {
        console.error('Failed to load config:', err);
      }
    },
    async saveConfig() {
      try {
        const res = await axios.post('/api/config', this.config);
        if (res.data.success) {
          this.saveMessage = 'Settings saved successfully!';
          setTimeout(() => { this.saveMessage = ''; }, 3000);
        }
      } catch (err) {
        console.error('Failed to save config:', err);
        alert('Failed to save config');
      }
    },
    async fetchDevices() {
      this.loading = true;
      try {
        const [domRes, haRes, pairingsRes] = await Promise.all([
          axios.get('/api/domoticz/devices'),
          axios.get('/api/ha/devices'),
          axios.get('/api/pairings')
        ]);
        
        if (pairingsRes.data) {
          this.pairings = pairingsRes.data;
        }
        
        if (domRes.data.success && Array.isArray(domRes.data.data)) {
          this.domoticzDevices = domRes.data.data;
        } else if (!domRes.data.success) {
          console.error('Domoticz API error:', domRes.data.error);
        }
        
        if (haRes.data.success && Array.isArray(haRes.data.data)) {
          // Filter out entities we don't usually pair like sun, automations, etc. (Keep light, switch, sensor, binary_sensor)
          this.haDevices = haRes.data.data.filter(e => {
            const domain = e.entity_id.split('.')[0];
            return ['light', 'switch', 'sensor', 'binary_sensor', 'climate', 'cover'].includes(domain);
          });
        } else if (!haRes.data.success) {
          console.error('HA API error:', haRes.data.error);
        }
      } catch (err) {
        console.error('Failed to fetch devices:', err);
        alert('Failed to fetch devices. Check settings and API accessibility.');
      } finally {
        this.loading = false;
      }
    },
    async pairToHa(device) {
      if (confirm(`Do you want to pair Domoticz Device "${device.Name}" to Home Assistant?`)) {
        try {
          const res = await axios.post('/api/pair/to-ha', { device });
          if (res.data.success) {
            alert('Pairing command sent! Check Home Assistant devices.');
            this.fetchDevices();
          } else {
            alert('Error: ' + res.data.message);
          }
        } catch (err) {
          console.error(err);
          alert('Failed to pair.');
        }
      }
    },
    async pairToDomoticz(entity) {
      if (confirm(`Do you want to pair HA Entity "${entity.entity_id}" to Domoticz?`)) {
        try {
          const res = await axios.post('/api/pair/to-domoticz', { entity });
          if (res.data.success) {
            alert('Pairing command sent! Check Domoticz devices.');
            this.fetchDevices();
          } else {
            alert('Error: ' + res.data.message);
          }
        } catch (err) {
          console.error(err);
          alert('Failed to pair.');
        }
      }
    },
    async unpair(idx) {
      if (confirm(`Do you really want to unpair Domoticz Device with IDX ${idx}? This will remove it from Home Assistant.`)) {
        try {
          const res = await axios.post('/api/unpair', { idx });
          if (res.data.success) {
            this.fetchDevices();
          } else {
            alert('Error: ' + res.data.message);
          }
        } catch (err) {
          console.error(err);
          alert('Failed to unpair.');
        }
      }
    }
  }
}).mount('#app');
