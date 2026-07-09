# CipherStream

A platform for covertly transporting encrypted messages and files through WebRTC video streams.

---

## The Problem

Traditional messaging systems expose their payloads through a visible channel, and even many experimental media-based transfer systems require a separate control path for coordination. That makes it difficult to demonstrate how data can be hidden inside ordinary live media traffic without changing the experience of a normal video call.

CipherStream addresses that gap by exploring a practical covert transport mechanism: two peers can join a room, establish a live WebRTC call, and exchange hidden data while the video stream continues to function as the carrier.

---

## Our Solution

CipherStream combines three layers to make covert transfer possible in a browser:

- a WebRTC media session for real-time video and audio exchange,
- a WebSocket signaling server for room membership and peer negotiation, and
- a custom packetization and frame-embedding pipeline that hides encrypted payloads inside encoded outbound video frames.

On the sender side, application data is encrypted, split into packets, and injected into the encoded video stream. On the receiver side, those packets are extracted from inbound frames, reassembled, decrypted, and surfaced as a message or downloadable file.

---

## Architecture

| Component | Responsibility |
|-----------|----------------|
| [server/server.js](server/server.js) | Implements the Express and WebSocket signaling service. It manages rooms, relays join and signaling events, and coordinates peer discovery without storing media or transfer payloads. |
| [client/src/App.jsx](client/src/App.jsx) | The main React application. It owns the UI state machine, WebRTC connection setup, room joining, camera access, session key exchange, transfer queueing, and hidden-transfer lifecycle. |
| [client/src/main.jsx](client/src/main.jsx) | Bootstraps the React application into the browser. |
| [client/src/lib/crypto.js](client/src/lib/crypto.js) | Wraps browser Web Crypto APIs for ECDH key generation, public key export/import, session key derivation, and AES-GCM encryption/decryption. |
| [client/src/lib/steganography.js](client/src/lib/steganography.js) | Defines the covert transport format. It packetizes data, appends packet bytes to encoded video frames, extracts them from inbound frames, and restores the original frame data. |
| [client/src/lib/bytes.js](client/src/lib/bytes.js) | Provides byte-concatenation helpers used by the crypto and steganography layers. |
| [client/src/lib/crc32.js](client/src/lib/crc32.js) | Computes CRC32 checksums for packet integrity verification. |
| [client/src/components/ui](client/src/components/ui) | Provides small reusable UI primitives such as buttons, cards, inputs, and badges used by the main experience. |
| [client/src/styles.css](client/src/styles.css) | Contains the application styling and layout rules. |

---

## How It Works

### Initialization

When the app loads, it resolves the signaling endpoint, initializes the React UI, and prompts the user for a room identifier. Once the user grants camera and microphone access, the client starts the local media stream and moves into the lobby state.

The signaling server listens for WebSocket connections and creates or joins a room based on the requested room code. The room acts as a lightweight coordination boundary for the two peers.

### Data Flow

The data path is intentionally split between signaling and covert transport:

1. The browser connects to the signaling server and joins a room.
2. The peers exchange SDP offers, answers, ICE candidates, and public keys through the WebSocket channel.
3. After the peer connection is established, the sender and receiver attach transform pipelines to the WebRTC encoded streams.
4. Application payloads are encrypted, packetized, and injected into outbound video frames.
5. The receiver extracts those packets from inbound frames, reconstructs the original payload, decrypts it, and displays the result.

### Core Processing

The covert-transfer pipeline is implemented in the steganography layer. Each transfer is divided into fixed-size payload chunks, prefixed with a compact header containing transfer metadata, packet indexing, and integrity information, and wrapped with a CRC32 checksum. The sender repeats each packet across multiple frame passes so the payload has more opportunities to survive the media pipeline.

### Backend Logic

The backend is intentionally minimal. It does not perform authentication, persist sessions, or relay media data. Its only responsibilities are:

- accepting WebSocket connections,
- creating and updating room state,
- broadcasting join and signaling events to peers in the same room, and
- cleaning up rooms when the last client disconnects.

### Frontend/UI

The frontend is a single-page React experience with distinct landing, lobby, and call states. During the call, it shows the local and remote video feeds, exposes controls for sending a hidden message or file, and renders live performance metrics such as packet embedding counts, recovered packets, and latency.



---

## Installation

### Prerequisites

- Node.js 18 or newer
- npm
- A modern browser with WebRTC support and encoded insertable stream support (Chrome or Edge are the most suitable choices)

### Install dependencies

```bash
npm install
```

### Build the client

```bash
npm run build
```

### Run locally

Start the signaling server:

```bash
npm run dev:server
```

In a second terminal, start the client:

```bash
npm run dev:client
```

Then open http://localhost:5173 in a browser.

---

## Usage

1. Open the application in two browser windows or on two devices.
2. Enter the same room identifier in both sessions.
3. Allow camera and microphone access.
4. Join the call and wait for the peer connection to become active.
5. Use the hidden message or hidden file controls to transfer data through the active video call.

The transfer path only works while the peer connection is established and both parties are using a compatible browser implementation.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| WebRTC for media transport | WebRTC provides a browser-native peer-to-peer media path and is well-suited to a live video call. |
| WebSocket-based signaling | Signaling is separated from media because WebRTC requires an out-of-band coordination channel before peer-to-peer data can be established. |
| Insertable encoded streams for covert transport | This design enables payload injection inside the media pipeline without adding a separate visible messaging channel. |
| ECDH + AES-GCM | The project uses standard browser cryptography primitives to protect the transferred content rather than relying on a plaintext transport. |
| Packet framing with headers and CRC32 | A lightweight framing format makes the transfer robust to partial reassembly and helps detect corrupted packets. |

---

