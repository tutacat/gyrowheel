const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const STATUS_CLASSES = {
  default: '',
  connecting: 'status-pill--connecting',
  connected: 'status-pill--connected',
  paused: 'status-pill--paused',
  error: 'status-pill--error',
};

class WheelController {
  constructor() {
    this.boundsRange = 180;
    this.bounds = this.computeBounds(this.boundsRange);
    this.channel = 'wheel';
    this.socketUrl = '';
    this.socket = null;
    this.errorState = false;
    this.paused = false;
    this.wheel = document.getElementById('wheel');
    this.readout = document.getElementById('rotation-readout');
    this.sensorButton = document.getElementById('sensor-toggle');
    this.socketForm = document.getElementById('socket-form');
    this.socketStatus = document.getElementById('socket-status');
    this.socketError = document.getElementById('socket-error');
    this.pauseButton = document.getElementById('socket-pause');
    this.lastSent = 0;
    this.rotation = 0;
    this.reference = null;
    this.handleOrientation = this.handleOrientation.bind(this);
    window.addEventListener('beforeunload', () => this.closeSocket());
    this.updatePauseButton();
    this.setStatus('Disconnected');
  }

  enableSensor(event) {
    event.preventDefault();
    if (this.sensorButton.disabled) return;
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      this.sensorButton.textContent = 'Unsupported';
      return;
    }
    this.requestPermission()
      .then(() => {
        window.addEventListener('deviceorientation', this.handleOrientation, true);
        this.sensorButton.disabled = true;
        this.sensorButton.textContent = 'Gyroscope Active';
        this.reference = null;
      })
      .catch((error) => {
        console.error(error);
        this.sensorButton.textContent = 'Permission Needed';
      });
  }

  async requestPermission() {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      const response = await DeviceOrientationEvent.requestPermission();
      if (response !== 'granted') {
        throw new Error('Gyroscope permission denied');
      }
    }
  }

  updateBounds(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const nextRange = Math.max(0, Number(form.range.value));
    if (Number.isNaN(nextRange)) {
      return;
    }
    this.boundsRange = nextRange;
    this.bounds = this.computeBounds(nextRange);
    form.range.value = nextRange;
    this.rotation = clamp(this.rotation, this.bounds.min, this.bounds.max);
    this.render();
  }

  recenter(event) {
    event.preventDefault();
    this.reference = null;
    this.rotation = 0;
    this.render();
    this.lastSent = 0;
    this.maybeSend();
  }

  configureSocket(event) {
    event.preventDefault();
    this.readSocketForm();
    this.showError('');
  }

  connectSocket(event) {
    event.preventDefault();
    this.readSocketForm();
    if (!this.socketUrl) {
      this.showError('Enter a WebSocket URL before connecting.');
      return;
    }
    this.openSocket();
  }

  disconnectSocket(event) {
    event.preventDefault();
    this.closeSocket();
    this.showError('');
  }

  togglePause(event) {
    event.preventDefault();
    this.paused = !this.paused;
    this.updatePauseButton();
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.setStatus(this.paused ? 'Paused' : 'Connected', this.paused ? 'paused' : 'connected');
      this.sendMessage('wheel.status', { status: this.paused ? 'paused' : 'resumed' });
    } else {
      this.setStatus('Disconnected');
    }
  }

  openSocket() {
    this.closeSocket();
    this.errorState = false;
    this.setStatus('Connecting…', 'connecting');
    this.showError('');
    try {
      this.socket = new WebSocket(this.socketUrl);
      this.socket.addEventListener('open', () => {
        this.setStatus(this.paused ? 'Paused' : 'Connected', this.paused ? 'paused' : 'connected');
        this.sendMessage('wheel.status', { status: 'connected' });
      });
      this.socket.addEventListener('close', () => {
        this.socket = null;
        if (!this.errorState) {
          this.setStatus('Disconnected');
        }
        this.errorState = false;
        this.updatePauseButton();
      });
      this.socket.addEventListener('error', () => {
        this.errorState = true;
        this.showError('WebSocket error occurred.');
        this.setStatus('Error', 'error');
        if (this.socket) {
          this.socket.close();
        }
      });
    } catch (error) {
      this.showError(error.message || 'Failed to connect.');
      this.setStatus('Error', 'error');
      this.socket = null;
    }
  }

  closeSocket() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.errorState = false;
    this.setStatus('Disconnected');
    this.updatePauseButton();
  }

  handleOrientation(event) {
    if (event.absolute === false && event.alpha === null) {
      return;
    }
    const raw = typeof event.alpha === 'number' ? event.alpha : 0;
    const angle = this.normalize(raw);
    if (this.reference === null) {
      this.reference = angle;
    }
    const delta = this.normalize(angle - this.reference);
    this.rotation = clamp(-delta, this.bounds.min, this.bounds.max);
    this.render();
    this.maybeSend();
  }

  normalize(angle) {
    let value = angle % 360;
    if (value > 180) value -= 360;
    if (value < -180) value += 360;
    return value;
  }

  render() {
    const rounded = Number.parseFloat(this.rotation.toFixed(1));
    this.wheel.style.setProperty('--wheel-angle', String(rounded));
    this.readout.value = `${rounded.toFixed(1)}°`;
  }

  maybeSend() {
    if (this.paused) {
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const now = performance.now();
    if (now - this.lastSent < 40) {
      return;
    }
    this.lastSent = now;
    this.sendMessage('wheel.rotation', {
      angle: this.rotation,
      unit: 'deg',
      channel: this.channel,
    });
  }

  sendMessage(type, payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const message = {
        type,
        timestamp: new Date().toISOString(),
        ...payload,
      };
      this.socket.send(JSON.stringify(message));
    }
  }

  readSocketForm() {
    if (!this.socketForm) return;
    this.socketUrl = this.socketForm.url.value.trim();
    const channel = (this.socketForm.channel.value || 'wheel').trim();
    this.channel = channel || 'wheel';
  }

  setStatus(label, tone = 'default') {
    if (!this.socketStatus) return;
    this.socketStatus.textContent = label;
    Object.values(STATUS_CLASSES).forEach((className) => {
      if (className) {
        this.socketStatus.classList.remove(className);
      }
    });
    const className = STATUS_CLASSES[tone] || STATUS_CLASSES.default;
    if (className) {
      this.socketStatus.classList.add(className);
    }
  }

  showError(message) {
    if (!this.socketError) return;
    this.socketError.textContent = message;
  }

  updatePauseButton() {
    if (!this.pauseButton) return;
    this.pauseButton.textContent = this.paused ? 'Resume' : 'Pause';
  }

  computeBounds(range) {
    const half = range / 2;
    return { min: -half, max: half };
  }
}

window.wheelController = new WheelController();
