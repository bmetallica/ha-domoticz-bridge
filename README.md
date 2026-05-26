# HA-Domoticz Bridge

Die HA-Domoticz Bridge verbindet Domoticz und Home Assistant über MQTT, REST-APIs und eine einfache Weboberfläche. Geräte aus Domoticz können per MQTT Discovery in Home Assistant eingebunden werden. Umgekehrt können ausgewählte Home-Assistant-Entitäten automatisch als Geräte in Domoticz angelegt und anschließend synchronisiert werden.


## Funktionen

- Weboberfläche zum Konfigurieren, Pairen und Entpairen
- Domoticz-Geräte nach Home Assistant per MQTT Discovery veröffentlichen
- Home-Assistant-Entitäten als neue Domoticz-Geräte anlegen
- Bidirektionale Synchronisierung von Zuständen
- Wiederherstellung vorhandener Pairings nach einem Neustart
- Speicherung der Konfiguration in `config.json`
- Speicherung aller Zuordnungen in `pairings.json`

## Unterstützte Richtungen

### Domoticz nach Home Assistant

Die Bridge veröffentlicht Domoticz-Geräte per MQTT Discovery in Home Assistant. Je nach Gerätetyp werden sie als Schalter oder Sensoren angelegt.

Typische unterstützte Gerätetypen:

- Light/Switch
- Temperatur
- Temperatur und Luftfeuchtigkeit
- Stromverbrauch und Energiezähler
- allgemeine Sensoren mit Zahlenwerten

### Home Assistant nach Domoticz

Die Bridge kann unterstützte Home-Assistant-Entitäten als neue Geräte in Domoticz erzeugen. Dabei wird bei Bedarf automatisch eine Dummy-Hardware mit dem Namen `HA Bridge` in Domoticz angelegt.

Unterstützte Home-Assistant-Domains bzw. Sensorklassen:

- `switch`
- `input_boolean`
- `light`
- `binary_sensor`
- `sensor`
- `number`
- `input_number`

Unter anderem werden folgende Sensorklassen abgebildet:

- Temperatur
- Luftfeuchtigkeit
- Druck
- Energie
- Gas
- Wasser
- CO2
- Spannung
- Stromstärke
- Beleuchtungsstärke
- Distanz
- Schalldruck
- UV
- Windgeschwindigkeit
- Batterie
- Bodenfeuchte
- Leistung
- numerische und textuelle Fallback-Sensoren

Nicht implementierte Entitätstypen werden in der Oberfläche zwar teilweise angezeigt, können aber von der Bridge abgelehnt werden.

## Architektur

Die Anwendung besteht aus drei Bausteinen:

- Express-Server für REST-API und Weboberfläche
- MQTT-Anbindung für Discovery und Zustandsübertragung
- API-Clients für Home Assistant und Domoticz

Die Weboberfläche läuft standardmäßig auf Port `3000`.

## Voraussetzungen

Für einen stabilen Betrieb sollten folgende Komponenten erreichbar sein:

- ein laufender MQTT-Broker
- eine erreichbare Home-Assistant-Instanz mit Long-Lived Access Token
- eine erreichbare Domoticz-Instanz mit Benutzername und Passwort
- in Home Assistant eine aktive MQTT-Integration mit aktiviertem Discovery-Präfix
- in Domoticz eine MQTT-Anbindung, die auf die konfigurierten Topics publiziert bzw. lauscht

Standardmäßig arbeitet die Bridge mit diesen Topics:

- Domoticz eingehend: `domoticz/in`
- Domoticz ausgehend: `domoticz/out`
- Home Assistant Discovery Prefix: `homeassistant`

## Installation mit Docker Compose

### 1. Repository klonen

```bash
git clone https://github.com/bmetallica/ha-domoticz-bridge.git
cd ha-domoticz-bridge
```

### 2. Konfiguration anpassen

Die Anwendung erwartet eine `config.json` im Projektverzeichnis. Passe die Werte an deine Umgebung an:

```json
{
  "mqtt": {
    "broker": "mqtt://192.168.1.10",
    "username": "",
    "password": ""
  },
  "ha": {
    "url": "http://192.168.1.20:8123",
    "token": "DEIN_LONG_LIVED_ACCESS_TOKEN",
    "discoveryPrefix": "homeassistant"
  },
  "domoticz": {
    "url": "http://192.168.1.30",
    "username": "DEIN_BENUTZER",
    "password": "DEIN_PASSWORT",
    "topicIn": "domoticz/in",
    "topicOut": "domoticz/out"
  }
}
```

Die Datei `pairings.json` kann leer bleiben:

```json
[]
```

### 3. Container starten

```bash
docker compose up -d --build
```

### 4. Weboberfläche öffnen

Im Browser:

```text
http://<dein-host>:3000
```

## Installation ohne Docker

### Voraussetzungen

- Node.js 20 oder neuer
- npm

### Schritte

```bash
npm install
npm start
```

Auch hier muss vorher die `config.json` angepasst werden.

## Bedienung

Die Oberfläche ist in drei Bereiche aufgeteilt:

### Dashboard

Hier werden ungepaarte Geräte und Entitäten angezeigt.

- links: ungepaarte Domoticz-Geräte
- rechts: ungepaarte Home-Assistant-Entitäten
- über `Refresh Devices` werden beide Seiten neu geladen

### Paired Devices

Hier sind alle aktiven Zuordnungen sichtbar. Pairings lassen sich an dieser Stelle wieder entfernen.

### Settings

Hier können MQTT-, Domoticz- und Home-Assistant-Zugangsdaten direkt in der Weboberfläche gepflegt werden. Nach dem Speichern wird die MQTT-Verbindung neu aufgebaut.

## Typischer Ablauf

### Domoticz nach Home Assistant

1. Bridge starten
2. Im Dashboard ein Domoticz-Gerät auswählen
3. `Pair to HA` auslösen
4. Die Bridge veröffentlicht MQTT-Discovery-Daten
5. Das Gerät erscheint in Home Assistant

### Home Assistant nach Domoticz

1. Bridge starten
2. Im Dashboard eine unterstützte HA-Entität auswählen
3. `Pair to Domoticz` auslösen
4. Die Bridge legt in Domoticz ein passendes Gerät an
5. Der Status wird anschließend regelmäßig synchronisiert

## Persistenz

- `config.json` enthält die Laufzeitkonfiguration
- `pairings.json` enthält alle gespeicherten Zuordnungen

Beim Start lädt die Bridge vorhandene Pairings erneut und stellt die MQTT-Discovery für Domoticz-basierte Pairings wieder her.

## Docker-Hinweise

Der mitgelieferte Compose-Stack bindet diese Dateien als Volumes ein:

- `./config.json:/app/config.json`
- `./pairings.json:/app/pairings.json`

Dadurch bleiben Konfiguration und Pairings auch nach Container-Neustarts erhalten.

## Fehlerbehebung

Wenn keine Geräte angezeigt werden oder das Pairing fehlschlägt, prüfe zuerst:

- Ist der MQTT-Broker erreichbar?
- Stimmt der Discovery-Präfix in Home Assistant?
- Sendet Domoticz auf `domoticz/out` und empfängt auf `domoticz/in`?
- Ist der Home-Assistant-Token gültig?
- Sind URL, Benutzername und Passwort für Domoticz korrekt?
- Ist Port `3000` von außen erreichbar?

Container-Logs anzeigen:

```bash
docker compose logs -f
```

## Sicherheit

- Zugangsdaten und Tokens sollten nicht mit echten Werten in ein öffentliches Repository eingecheckt werden.
- Verwende für GitHub nur bereinigte Beispielwerte in `config.json`.
- Wenn das Projekt öffentlich wird, sollten bestehende Tokens und Passwörter vorsorglich erneuert werden.

## Projektstruktur

```text
.
├── Dockerfile
├── docker-compose.yml
├── config.json
├── pairings.json
├── public
│   ├── app.js
│   └── index.html
└── server
    ├── index.js
    ├── config.js
    ├── mqttClient.js
    ├── pairingManager.js
    ├── poller.js
    ├── syncManager.js
    └── apiClients
        ├── domoticz.js
        └── ha.js
```

## Lizenz

Dieses Projekt steht unter der MIT-Lizenz. Details findest du in der Datei `LICENSE`.