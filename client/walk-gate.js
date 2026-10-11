/**
 * Trailtale Walk Gate
 * Detects whether the user is moving or still using Geolocation + DeviceMotion.
 * Speed ≥ 0.5 m/s for 3s = moving. Below that for 3s = still.
 *
 * Exports: WalkGate class
 */

class WalkGate {
  constructor(onStateChange) {
    this.onStateChange = onStateChange; // callback(isMoving, speed)
    this.isMoving = false;
    this.speed = 0;
    this.movingStartTime = null;
    this.stillStartTime = null;
    this.geoWatchId = null;
    this.lastPosition = null;
    this.lastTimestamp = null;

    // Thresholds from the design doc
    this.SPEED_THRESHOLD = 0.5; // m/s
    this.CONFIRM_SECONDS = 3; // seconds to confirm state change

    // Accumulated step data from DeviceMotion
    this.accelSamples = [];
    this.stepDetected = false;
  }

  async start() {
    // Request permissions
    if (
      "DeviceMotionEvent" in window &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      try {
        const perm = await DeviceMotionEvent.requestPermission();
        if (perm !== "granted") console.warn("DeviceMotion permission denied");
      } catch (e) {
        console.warn("DeviceMotion permission error:", e);
      }
    }

    // Start geolocation watching
    if ("geolocation" in navigator) {
      this.geoWatchId = navigator.geolocation.watchPosition(
        (pos) => this._onGeoPosition(pos),
        (err) => console.warn("Geo error:", err.message),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 },
      );
    }

    // Start DeviceMotion for step detection (GPS drift fallback)
    window.addEventListener("devicemotion", (e) => this._onDeviceMotion(e));

    // Tick every second to update state
    this._tickInterval = setInterval(() => this._tick(), 1000);
  }

  stop() {
    if (this.geoWatchId !== null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    window.removeEventListener("devicemotion", this._onDeviceMotion);
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
  }

  _onGeoPosition(pos) {
    const now = Date.now();
    const geoSpeed = pos.coords.speed; // may be null

    if (geoSpeed !== null && geoSpeed >= 0) {
      this.speed = geoSpeed;
    } else if (this.lastPosition && this.lastTimestamp) {
      // Calculate speed from position delta
      const dt = (now - this.lastTimestamp) / 1000;
      if (dt > 0) {
        const dist = this._haversine(
          this.lastPosition.latitude,
          this.lastPosition.longitude,
          pos.coords.latitude,
          pos.coords.longitude,
        );
        this.speed = dist / dt;
      }
    }

    this.lastPosition = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
    this.lastTimestamp = now;

    // Send motion update to server
    this._sendMotionUpdate(pos.coords.latitude, pos.coords.longitude);
  }

  _onDeviceMotion(event) {
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;
    const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
    this.accelSamples.push(magnitude);
    // Keep last 50 samples (~1 second at 50Hz)
    if (this.accelSamples.length > 50) this.accelSamples.shift();

    // Simple step detection: check for acceleration spikes
    const avg =
      this.accelSamples.reduce((a, b) => a + b, 0) / this.accelSamples.length;
    this.stepDetected = Math.abs(magnitude - avg) > 2.5;
  }

  _tick() {
    const now = Date.now();
    const aboveThreshold =
      this.speed >= this.SPEED_THRESHOLD || this.stepDetected;

    if (aboveThreshold) {
      this.stillStartTime = null;
      if (!this.movingStartTime) this.movingStartTime = now;

      if (
        !this.isMoving &&
        now - this.movingStartTime >= this.CONFIRM_SECONDS * 1000
      ) {
        this.isMoving = true;
        this.onStateChange(true, this.speed);
      }
    } else {
      this.movingStartTime = null;
      if (!this.stillStartTime) this.stillStartTime = now;

      if (
        this.isMoving &&
        now - this.stillStartTime >= this.CONFIRM_SECONDS * 1000
      ) {
        this.isMoving = false;
        this.onStateChange(false, this.speed);
      }
    }
  }

  _haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async _sendMotionUpdate(lat, lon) {
    if (!window.trailtaleState?.walkId) return;
    try {
      const url = "/api/walk/motion";
      const candidates = [
        url,
        `http://localhost:8000${url}`,
        `http://127.0.0.1:8000${url}`,
        `${window.location.origin}${url}`,
      ];

      let lastError = null;
      for (const candidate of [...new Set(candidates)]) {
        try {
          const response = await fetch(candidate, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              walk_id: window.trailtaleState.walkId,
              speed_mps: this.speed,
              latitude: lat,
              longitude: lon,
              timestamp: new Date().toISOString(),
            }),
          });
          if (response.ok) return;
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError) throw lastError;
    } catch (e) {
      // Offline — that's OK, we track locally
    }
  }
}

window.WalkGate = WalkGate;
