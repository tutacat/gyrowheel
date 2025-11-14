# Gyro Wheel WebSocket API Specification

## Overview

The Gyro Wheel web app streams device-orientation data to a configurable WebSocket
endpoint. Once the user enables the device gyroscope and connects to a server, the
app publishes normalized wheel rotation updates and lifecycle notifications. This
document describes the payloads sent by the client so that a server can reliably
consume them.

All messages are encoded as UTF-8 JSON objects in a single WebSocket channel. Each
object contains a `type` field used for routing and can include additional fields
depending on the message.

## Connection Lifecycle

1. **Connect** – When the user taps **Connect**, the app opens a WebSocket to the
   configured URL. If successful, it immediately sends a `wheel.status` message
   with `status: "connected"`.
2. **Disconnect** – Choosing **Disconnect** (or navigating away) closes the
   socket without additional payloads. Servers should treat the close frame as the
   session end.
3. **Pause / Resume** – While connected, the **Pause** button toggles between
   paused and active states. A `wheel.status` message announces each transition.
4. **Errors** – Network or protocol errors close the connection. The client marks
   the session as errored and stops sending additional data until the user retries.

The app throttles outbound telemetry to at most once every 40 ms (~25 Hz) to balance
responsiveness and bandwidth.

## Message Types

### `wheel.status`

Lifecycle updates about the socket connection and publishing state.

| Field       | Type   | Description                                               |
| ----------- | ------ | --------------------------------------------------------- |
| `type`      | string | Constant string `"wheel.status"`.                         |
| `timestamp` | string | ISO 8601 timestamp indicating when the event was emitted. |
| `status`    | string | One of `"connected"`, `"paused"`, `"resumed"`.            |
| `channel`   | string | Identifier from the **Channel** field in the UI.          |

**Notes**

- A `"connected"` or `"paused"` status is always sent immediately after a
  successful WebSocket handshake, reflecting the current publish state.
- When the user toggles pause, the app sends `"paused"` or `"resumed"` as the status
  and keeps the socket open. While paused, no rotation telemetry is transmitted.

### `wheel.rotation`

Periodic wheel orientation measurements normalized to the user-defined symmetric
rotation bounds.

| Field       | Type   | Description                                                       |
| ----------- | ------ | ----------------------------------------------------------------- |
| `type`      | string | Constant string `"wheel.rotation"`.                               |
| `timestamp` | string | ISO 8601 timestamp for the reading.                               |
| `angle`     | number | Current wheel angle in degrees after clamping to the range.       |
| `unit`      | string | Constant string `"deg"`.                                          |
| `channel`   | string | Identifier mirroring the **Channel** UI field (defaults `wheel`). |

**Notes**

- The reported `angle` is constrained to half the configured total range (e.g.
  `±90` degrees when the range is `180`).
- Rotation data is only sent when the socket is connected, not paused, and the
  40 ms throttling interval has elapsed.

## Server Expectations

- Servers should accept and parse JSON payloads conforming to the tables above.
- Responses are optional; the current client does not consume inbound messages,
  but the protocol leaves room for future bidirectional commands.
- It is safe for the server to close the connection at any time. The client will
  stop publishing updates until the user reconnects.

## Versioning

This specification describes the initial stable API shipped with the Gyro Wheel
app. Backward-incompatible changes will be documented with versioned updates to
this file. Servers should ignore unrecognized fields to remain forward-compatible.
