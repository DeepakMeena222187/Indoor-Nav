/**
 * NavPrime GPS Worker v2.0
 * ════════════════════════════════════════
 * Runs off main thread via Web Worker:
 *  • Kalman filter GPS smoothing
 *  • Dead reckoning (fill GPS gaps)
 *  • Speed + bearing estimation
 *  • Accuracy grading
 * ════════════════════════════════════════
 */

'use strict';

// ── Inline Kalman filter (worker can't import modules easily) ──
class KalmanGPS {
  constructor() {
    this.x = null;
    this.P = [[10,0,0,0],[0,10,0,0],[0,0,1,0],[0,0,0,1]];
    this.lastTs = null;
    this.Q_pos = 0.0001, this.Q_vel = 0.001;
    this.history = []; // last 10 positions for smoothing
  }

  process(lat, lon, accuracy, timestamp) {
    if (!this.x) {
      this.x = [lat, lon, 0, 0];
      this.lastTs = timestamp;
      this.history.push({lat, lon, ts: timestamp});
      return { lat, lon, speed: 0, bearing: 0, confidence: 0.5, source: 'init' };
    }

    const dt = Math.min((timestamp - this.lastTs) / 1000, 3);
    this.lastTs = timestamp;

    // PREDICT
    const xp = [
      this.x[0] + this.x[2] * dt,
      this.x[1] + this.x[3] * dt,
      this.x[2],
      this.x[3],
    ];

    // Simple P prediction (omitting full matrix for worker performance)
    const Pp = [
      [this.P[0][0] + this.Q_pos + dt*this.P[2][0], this.P[0][1], this.P[0][2]+dt*this.P[2][2], this.P[0][3]],
      [this.P[1][0], this.P[1][1] + this.Q_pos + dt*this.P[3][1], this.P[1][2], this.P[1][3]+dt*this.P[3][3]],
      [this.P[2][0], this.P[2][1], this.P[2][2] + this.Q_vel, this.P[2][3]],
      [this.P[3][0], this.P[3][1], this.P[3][2], this.P[3][3] + this.Q_vel],
    ];

    // UPDATE with GPS measurement
    const r = Math.max(0.00001, (accuracy / 111320)**2);
    const K = [
      [Pp[0][0]/(Pp[0][0]+r), Pp[0][1]/(Pp[1][1]+r)],
      [Pp[1][0]/(Pp[0][0]+r), Pp[1][1]/(Pp[1][1]+r)],
      [Pp[2][0]/(Pp[0][0]+r), Pp[2][1]/(Pp[1][1]+r)],
      [Pp[3][0]/(Pp[0][0]+r), Pp[3][1]/(Pp[1][1]+r)],
    ];

    const yLat = lat - xp[0];
    const yLon = lon - xp[1];

    this.x = [
      xp[0] + K[0][0]*yLat,
      xp[1] + K[1][1]*yLon,
      xp[2] + K[2][0]*yLat,
      xp[3] + K[3][1]*yLon,
    ];

    this.P[0][0] = (1 - K[0][0]) * Pp[0][0];
    this.P[1][1] = (1 - K[1][1]) * Pp[1][1];
    this.P[2][2] = Pp[2][2];
    this.P[3][3] = Pp[3][3];

    // Estimate speed + bearing from velocity state
    const vLat = this.x[2], vLon = this.x[3];
    const speedMps = Math.sqrt(vLat**2 + vLon**2) * 111320;
    const bearingRad = Math.atan2(vLon, vLat);
    const bearing = (bearingRad * 180 / Math.PI + 360) % 360;

    // Confidence based on accuracy
    const confidence = Math.max(0, Math.min(1, 1 - (accuracy - 3) / 50));

    this.history.push({ lat: this.x[0], lon: this.x[1], ts: timestamp });
    if (this.history.length > 10) this.history.shift();

    return {
      lat: this.x[0],
      lon: this.x[1],
      speed: speedMps * 3.6, // km/h
      speedMps,
      bearing,
      confidence,
      accuracy,
      source: 'kalman',
    };
  }

  deadReckon(ms) {
    if (!this.x) return null;
    const dt = ms / 1000;
    return {
      lat: this.x[0] + this.x[2] * dt,
      lon: this.x[1] + this.x[3] * dt,
      speed: Math.sqrt(this.x[2]**2 + this.x[3]**2) * 111320 * 3.6,
      confidence: Math.max(0.1, 0.9 - dt * 0.15),
      source: 'dead_reckoning',
    };
  }
}

// ── Worker state ──
const kalman = new KalmanGPS();
let lastGPSTime = null;
let deadReckonTimer = null;
let gpsDropoutMs = 0;

// ── Message handler ──
self.onmessage = function(e) {
  const { type, data } = e.data;

  if (type === 'GPS_UPDATE') {
    lastGPSTime = data.timestamp;
    gpsDropoutMs = 0;
    clearInterval(deadReckonTimer);

    const result = kalman.process(data.lat, data.lon, data.accuracy || 10, data.timestamp);

    self.postMessage({
      type: 'POSITION',
      data: {
        ...result,
        rawLat: data.lat,
        rawLon: data.lon,
        heading: data.heading,
        altitudeM: data.altitude,
        timestamp: data.timestamp,
      }
    });

    // Start dead reckoning fallback if GPS drops
    deadReckonTimer = setInterval(() => {
      gpsDropoutMs += 500;
      if (gpsDropoutMs > 2000) {
        const pred = kalman.deadReckon(gpsDropoutMs);
        if (pred) {
          self.postMessage({ type: 'POSITION', data: { ...pred, timestamp: Date.now() } });
        }
      }
      if (gpsDropoutMs > 30000) {
        clearInterval(deadReckonTimer);
        self.postMessage({ type: 'GPS_LOST', data: { duration: gpsDropoutMs } });
      }
    }, 500);
  }

  if (type === 'GET_VELOCITY') {
    if (kalman.x) {
      const vLat = kalman.x[2], vLon = kalman.x[3];
      const speedMps = Math.sqrt(vLat**2 + vLon**2) * 111320;
      self.postMessage({
        type: 'VELOCITY',
        data: { speed: speedMps * 3.6, speedMps, bearing: (Math.atan2(vLon, vLat) * 180 / Math.PI + 360) % 360 }
      });
    }
  }

  if (type === 'RESET') {
    kalman.x = null;
    kalman.history = [];
    clearInterval(deadReckonTimer);
    gpsDropoutMs = 0;
  }
};
