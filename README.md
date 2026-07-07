# CipherStream - Covert Transfer Over WebRTC Video

CipherStream is a full-stack WebRTC prototype that lets two peers join a secure room, start a live video call, and secretly transfer encrypted messages or files by embedding packetized payloads inside encoded video frames.

Unlike a normal chat app, CipherStream does not rely on a standard visible messaging channel for hidden transfers. Instead, it uses WebRTC encoded insertable streams to hide encrypted payloads directly inside outbound video data and recover them on the receiving side.

---

## Deployed App

Project URL:

`https://cipher-stream-client1.vercel.app/`


## Key Features

- Secure room-based peer-to-peer WebRTC calling
- WebSocket signaling server for room join, SDP exchange, ICE exchange, and public key exchange
- Hidden encrypted message transfer inside encoded video frames
- Hidden encrypted file transfer inside encoded video frames
- ECDH public key exchange for deriving a shared session key
- AES-GCM payload encryption for covert transfers
- Real-time packet embedding and extraction using WebRTC insertable streams
- Live call metrics including FPS, latency, embedded packets, and payload overhead
- Simple two-workspace setup with separate client and server

---

## Tech Stack

| Layer | Tech Used |
|---|---|
| Frontend | React 19 + Vite |
| Backend | Node.js + Express |
| Realtime Signaling | WebSocket (`ws`) |
| Media Transport | WebRTC |
| Covert Transport | Encoded Insertable Streams |
| Cryptography | Web Crypto API, ECDH, AES-GCM |
| Styling | CSS |

---

## Project Structure

client/  
├── src/App.jsx -> Main application flow, WebRTC setup, room handling, covert transfer UI  
├── src/lib/crypto.js -> Key generation, public key exchange helpers, encryption/decryption  
├── src/lib/steganography.js -> Packet embedding, extraction, packetization, reconstruction  
├── src/lib/bytes.js -> Byte utilities  
├── src/lib/crc32.js -> Packet integrity helpers  
├── src/lib/encode*.js -> Payload/encoding helpers  
└── src/styles.css -> App styling  

server/  
├── server.js -> Signaling server for rooms and peer messages  
└── package.json -> Backend workspace config  

README.md -> Project documentation  
package.json -> Root workspace scripts  

---

## How It Works

1. Two peers open the app and join the same room.
2. The signaling server helps them exchange SDP offers, answers, ICE candidates, and public keys.
3. Each peer generates an ECDH keypair and derives a shared session key.
4. Hidden messages or files are encrypted and split into packets.
5. On the sender side, packets are embedded into encoded outbound video frames.
6. On the receiver side, packets are extracted from encoded inbound video frames.
7. Once all packets arrive, the payload is decrypted and reconstructed into a message or downloadable file.

---








