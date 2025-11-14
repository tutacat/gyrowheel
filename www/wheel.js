const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const statusTone = {
  default: "",
  connecting: "status-pill--connecting",
  connected: "status-pill--connected",
  paused: "status-pill--paused",
  error: "status-pill--error",
};

const els = {
  wheel: document.getElementById("wheel"),
  readout: document.getElementById("rotation-readout"),
  sensorButton: document.getElementById("sensor-toggle"),
  socketForm: document.getElementById("socket-form"),
  socketStatus: document.getElementById("socket-status"),
  socketError: document.getElementById("socket-error"),
  pauseButton: document.getElementById("socket-pause"),
};

const state = {
  range: 180,
  bounds: { min: -90, max: 90 },
  rotation: 0,
  reference: null,
  socket: null,
  socketUrl: "",
  channel: "wheel",
  paused: false,
  error: false,
  lastSent: 0,
};

const sanitizeRange = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return state.range;
  return Math.max(0, parsed);
};

const computeBounds = (range) => {
  const half = range / 2;
  return { min: -half, max: half };
};

const setStatus = (label, tone = "default") => {
  if (!els.socketStatus) return;
  els.socketStatus.textContent = label;
  Object.values(statusTone).forEach((className) => {
    if (className) els.socketStatus.classList.remove(className);
  });
  const className = statusTone[tone];
  if (className) els.socketStatus.classList.add(className);
};

const showError = (message) => {
  if (!els.socketError) return;
  els.socketError.textContent = message;
};

const updatePauseButton = () => {
  if (!els.pauseButton) return;
  const readyState = state.socket ? state.socket.readyState : WebSocket.CLOSED;
  els.pauseButton.textContent = state.paused ? "Resume" : "Pause";
  els.pauseButton.disabled = readyState !== WebSocket.OPEN;
};

const updateButtonsForSocket = () => {
  const connectBtn = document.getElementById("socket-connect");
  const disconnectBtn = document.getElementById("socket-disconnect");
  const readyState = state.socket ? state.socket.readyState : WebSocket.CLOSED;
  if (connectBtn)
    connectBtn.disabled =
      readyState === WebSocket.CONNECTING || readyState === WebSocket.OPEN;
  if (disconnectBtn)
    disconnectBtn.disabled =
      readyState !== WebSocket.CONNECTING && readyState !== WebSocket.OPEN;
  updatePauseButton();
};

const renderRotation = () => {
  const value = Number(state.rotation.toFixed(1));
  els.wheel?.style.setProperty("--wheel-angle", String(value));
  if (els.readout) els.readout.value = `${value.toFixed(1)}°`;
};

const sendMessage = (type, payload) => {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.socket.send(
    JSON.stringify({
      type,
      timestamp: new Date().toISOString(),
      channel: state.channel,
      ...payload,
    }),
  );
};

const sendRotation = () => {
  const now = performance.now();
  if (now - state.lastSent < 40) return;
  state.lastSent = now;
  sendMessage("wheel.rotation", {
    angle: state.rotation,
    unit: "deg",
  });
};

const maybePublish = () => {
  if (state.paused) return;
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  sendRotation();
};

const normalizeAngle = (angle) => {
  let value = angle % 360;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
};

const handleOrientation = (event) => {
  if (event.absolute === false && event.alpha === null) return;
  const raw = typeof event.alpha === "number" ? event.alpha : 0;
  const angle = normalizeAngle(raw);
  if (state.reference === null) state.reference = angle;
  const delta = normalizeAngle(angle - state.reference);
  state.rotation = clamp(-delta, state.bounds.min, state.bounds.max);
  renderRotation();
  maybePublish();
};

const enableSensor = (event) => {
  event.preventDefault();
  if (!els.sensorButton || els.sensorButton.disabled) return;
  if (typeof window.DeviceOrientationEvent === "undefined") {
    els.sensorButton.textContent = "Unsupported";
    return;
  }
  const attach = () => {
    window.addEventListener("deviceorientation", handleOrientation, true);
    els.sensorButton.disabled = true;
    els.sensorButton.textContent = "Gyroscope Active";
    state.reference = null;
  };
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    DeviceOrientationEvent.requestPermission()
      .then((result) => {
        if (result !== "granted") throw new Error("denied");
        attach();
      })
      .catch(() => {
        els.sensorButton.textContent = "Permission Needed";
      });
  } else {
    attach();
  }
};

const updateBounds = (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const range = sanitizeRange(form.range.value);
  state.range = range;
  state.bounds = computeBounds(range);
  form.range.value = String(range);
  state.rotation = clamp(state.rotation, state.bounds.min, state.bounds.max);
  renderRotation();
  maybePublish();
};

const recenter = (event) => {
  event.preventDefault();
  state.reference = null;
  state.rotation = 0;
  renderRotation();
  state.lastSent = 0;
  maybePublish();
};

const readSocketForm = () => {
  if (!els.socketForm) return;
  state.socketUrl = (els.socketForm.url.value || "").trim();
  const channel = (els.socketForm.channel.value || "wheel").trim();
  state.channel = channel || "wheel";
};

const configureSocket = (event) => {
  event.preventDefault();
  readSocketForm();
  showError("");
};

const closeSocket = () => {
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
  state.error = false;
  setStatus("Disconnected");
  updateButtonsForSocket();
};

const onSocketOpen = () => {
  setStatus(
    state.paused ? "Paused" : "Connected",
    state.paused ? "paused" : "connected",
  );
  sendMessage("wheel.status", {
    status: state.paused ? "paused" : "connected",
  });
  updateButtonsForSocket();
  maybePublish();
};

const onSocketClose = () => {
  state.socket = null;
  if (!state.error) setStatus("Disconnected");
  state.error = false;
  updateButtonsForSocket();
};

const onSocketError = () => {
  state.error = true;
  showError("WebSocket error occurred.");
  setStatus("Error", "error");
  if (state.socket) state.socket.close();
};

const openSocket = () => {
  closeSocket();
  state.error = false;
  setStatus("Connecting…", "connecting");
  showError("");
  try {
    state.socket = new WebSocket(state.socketUrl);
    state.socket.addEventListener("open", onSocketOpen);
    state.socket.addEventListener("close", onSocketClose);
    state.socket.addEventListener("error", onSocketError);
  } catch (error) {
    showError(error?.message || "Failed to connect.");
    setStatus("Error", "error");
    state.socket = null;
  }
  updateButtonsForSocket();
};

const connectSocket = (event) => {
  event.preventDefault();
  readSocketForm();
  if (!state.socketUrl) {
    showError("Enter a WebSocket URL before connecting.");
    return;
  }
  openSocket();
};

const disconnectSocket = (event) => {
  event.preventDefault();
  closeSocket();
  showError("");
};

const togglePause = (event) => {
  event.preventDefault();
  state.paused = !state.paused;
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    const tone = state.paused ? "paused" : "connected";
    setStatus(state.paused ? "Paused" : "Connected", tone);
    sendMessage("wheel.status", {
      status: state.paused ? "paused" : "resumed",
    });
  } else {
    setStatus("Disconnected");
  }
  updatePauseButton();
};

window.addEventListener("beforeunload", closeSocket);
renderRotation();
updateButtonsForSocket();

window.wheelController = {
  enableSensor,
  updateBounds,
  recenter,
  configureSocket,
  connectSocket,
  disconnectSocket,
  togglePause,
};
