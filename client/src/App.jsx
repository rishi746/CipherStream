import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createKeyPair,
  decodeJson,
  decodeString,
  deriveSessionKey,
  encodeBlobUrl,
  encodeJson,
  encodeString,
  exportPublicKey,
  importPublicKey,
  maybeDecryptBytes,
  maybeEncryptBytes,
} from "./lib/crypto.js";
import { concatBytes } from "./lib/bytes.js";
import {
  appendPacketToEncodedFrame,
  extractPacketFromEncodedFrame,
  packetizeTransfer,
  unpackPacket,
} from "./lib/steganography.js";
import { Badge } from "./components/ui/badge.jsx";
import { Button } from "./components/ui/button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.jsx";
import { Input, Textarea } from "./components/ui/input.jsx";
import { Separator } from "./components/ui/separator.jsx";

function resolveSignalUrl() {
  const configured = import.meta.env.VITE_SIGNAL_URL?.trim();
  if (configured) return configured;

  if (typeof window !== "undefined") {
    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (isLocalhost) return "http://localhost:3001";
    return window.location.origin;
  }

  return "http://localhost:3001";
}

const SIGNAL_URL = resolveSignalUrl();
const VIDEO_CONSTRAINTS = {
  audio: true,
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  },
};
const PACKET_REPEAT_ROUNDS = 40;

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}


function toWebSocketUrl(url) {
  const base = typeof window !== "undefined" ? window.location.href : "http://localhost:3001";
  const resolved = new URL(url, base);
  if (resolved.protocol === "https:") {
    resolved.protocol = "wss:";
  } else if (resolved.protocol === "http:") {
    resolved.protocol = "ws:";
  }
  return resolved.toString();
}

function createSignaling(url) {
  let socket;
  const listeners = new Map();
  return {
    connect() {
      socket = new WebSocket(toWebSocketUrl(url));
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        listeners.get(message.type)?.(message.payload);
      });
      return socket;
    },
    emit(type, payload) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, payload }));
      }
    },
    on(type, handler) {
      listeners.set(type, handler);
    },
  };
}

export default function App() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const queueRef = useRef([]);
  const extractorSeenRef = useRef(new Set());
  const transfersRef = useRef(new Map());
  const fpsFrameRequestRef = useRef(null);
  const fpsLastSampleRef = useRef({ presentedFrames: 0, timestamp: 0 });
  const statsIntervalRef = useRef(null);
  const roomCodeRef = useRef("");
  const joinedRoomRef = useRef("");
  const peerReadyRef = useRef(false);
  const politePeerRef = useRef(false);
  const senderTransformsRef = useRef(new WeakSet());
  const receiverTransformsRef = useRef(new WeakSet());
  const nextTransferIdRef = useRef(1);
  const keyPairRef = useRef(null);
  const remotePublicKeyRef = useRef(null);
  const sessionKeyRef = useRef(null);
  const publicKeySentRef = useRef(false);

  const [view, setView] = useState("landing");
  const [roomCode, setRoomCode] = useState("");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [status, setStatus] = useState("");
  const [callActive, setCallActive] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [message, setMessage] = useState("");

  const [receivedMessages, setReceivedMessages] = useState([]);
  const [incomingFiles, setIncomingFiles] = useState([]);
  const [outgoingTransfers, setOutgoingTransfers] = useState([]);
  const [metrics, setMetrics] = useState({
    fps: 0,
    queueDepth: 0,
    packetsEmbedded: 0,
    packetsRecovered: 0,
    payloadOverhead: 0,
    latencyMs: 0,
  });

  const signaling = useMemo(() => createSignaling(SIGNAL_URL), []);

  function playMedia(element, label) {
    if (!element || !element.paused) return;
    element.play().catch((error) => {
      console.error(`Failed to play ${label}.`, error);
    });
  }

  useEffect(() => {
    syncLocalVideo();
    syncRemoteVideo();
  }, [view, remoteReady]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || view === "landing") {
      setMetrics((current) => ({ ...current, fps: 0 }));
      return undefined;
    }

    let cancelled = false;
    fpsLastSampleRef.current = { presentedFrames: 0, timestamp: 0 };

    if (typeof video.requestVideoFrameCallback === "function") {
      const updateFps = (_, metadata) => {
        if (cancelled) return;
        const previous = fpsLastSampleRef.current;
        if (previous.timestamp > 0 && metadata.mediaTime !== undefined) {
          const frameDelta = metadata.presentedFrames - previous.presentedFrames;
          const timeDeltaMs = metadata.expectedDisplayTime - previous.timestamp;
          if (frameDelta >= 0 && timeDeltaMs > 0) {
            const fps = Number(((frameDelta * 1000) / timeDeltaMs).toFixed(1));
            setMetrics((current) => ({ ...current, fps }));
          }
        }
        fpsLastSampleRef.current = {
          presentedFrames: metadata.presentedFrames,
          timestamp: metadata.expectedDisplayTime,
        };
        fpsFrameRequestRef.current = video.requestVideoFrameCallback(updateFps);
      };

      fpsFrameRequestRef.current = video.requestVideoFrameCallback(updateFps);

      return () => {
        cancelled = true;
        if (fpsFrameRequestRef.current !== null) {
          video.cancelVideoFrameCallback?.(fpsFrameRequestRef.current);
          fpsFrameRequestRef.current = null;
        }
      };
    }

    const fallbackFps = Number((localStreamRef.current?.getVideoTracks?.()[0]?.getSettings?.().frameRate || 0).toFixed(1));
    setMetrics((current) => ({ ...current, fps: fallbackFps }));
    return undefined;
  }, [view, callActive]);

  useEffect(() => {
    if (!callActive || !peerRef.current?.connection) {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
      setMetrics((current) => ({ ...current, latencyMs: 0 }));
      return undefined;
    }

    const connection = peerRef.current.connection;
    const pollStats = async () => {
      try {
        const report = await connection.getStats();
        let latencyMs = 0;

        report.forEach((stat) => {
          if (latencyMs) return;
          if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.currentRoundTripTime != null) {
            latencyMs = Number((stat.currentRoundTripTime * 1000).toFixed(1));
          }
        });

        if (!latencyMs) {
          report.forEach((stat) => {
            if (latencyMs) return;
            if (stat.type === "remote-inbound-rtp" && stat.kind === "video" && stat.roundTripTime != null) {
              latencyMs = Number((stat.roundTripTime * 1000).toFixed(1));
            }
          });
        }

        setMetrics((current) => ({ ...current, latencyMs }));
      } catch (error) {
        console.error(error);
      }
    };

    pollStats();
    statsIntervalRef.current = setInterval(pollStats, 1000);

    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    };
  }, [callActive]);

  useEffect(() => {
    const socket = signaling.connect();

    signaling.on("room-joined", ({ roomCode: code }) => {
      joinedRoomRef.current = code;
      setJoinedRoom(code);
      setStatus(`Joined secure room ${code}`);
    });

    signaling.on("peer-ready", async ({ polite }) => {
      peerReadyRef.current = true;
      politePeerRef.current = polite;
      await ensureSessionCrypto(codeOrRoom());
      await ensurePeerConnection(polite, codeOrRoom());
    });

    signaling.on("signal", async ({ description, candidate, publicKey }) => {
      if (publicKey) {
        await handleRemotePublicKey(publicKey);
      }

      await ensurePeerConnection(true, codeOrRoom());
      const peer = peerRef.current;
      if (!peer) return;

      if (description) {
        const readyForOffer = !peer.makingOffer
          && (peer.connection.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
        const offerCollision = description.type === "offer" && !readyForOffer;
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        peer.isSettingRemoteAnswerPending = description.type === "answer";
        await peer.connection.setRemoteDescription(description);
        peer.isSettingRemoteAnswerPending = false;

        if (description.type === "offer") {
          await peer.connection.setLocalDescription(await peer.connection.createAnswer());
          signaling.emit("signal", {
            roomCode: codeOrRoom(),
            description: peer.connection.localDescription,
          });
        }
      } else if (candidate) {
        try {
          await peer.connection.addIceCandidate(candidate);
        } catch (error) {
          if (!peer.ignoreOffer) console.error(error);
        }
      }
    });

    socket.addEventListener("open", () => { });
    return () => socket.close();
  }, [signaling]);

  function codeOrRoom() {
    return joinedRoomRef.current || roomCodeRef.current;
  }

  function resetSessionCrypto() {
    keyPairRef.current = null;
    remotePublicKeyRef.current = null;
    sessionKeyRef.current = null;
    publicKeySentRef.current = false;
  }

  async function deriveSessionIfReady() {
    if (sessionKeyRef.current || !keyPairRef.current || !remotePublicKeyRef.current) {
      return sessionKeyRef.current;
    }

    sessionKeyRef.current = await deriveSessionKey(
      keyPairRef.current.privateKey,
      remotePublicKeyRef.current,
    );
    setStatus("Secure session key established.");
    flushCompletedTransfers();
    return sessionKeyRef.current;
  }

  async function ensureSessionCrypto(targetRoom) {
    if (!keyPairRef.current) {
      keyPairRef.current = await createKeyPair();
    }

    if (!publicKeySentRef.current && targetRoom && keyPairRef.current) {
      const publicKey = await exportPublicKey(keyPairRef.current.publicKey);
      signaling.emit("signal", { roomCode: targetRoom, publicKey });
      publicKeySentRef.current = true;
    }

    await deriveSessionIfReady();
  }

  async function handleRemotePublicKey(publicKey) {
    remotePublicKeyRef.current = await importPublicKey(publicKey);
    await deriveSessionIfReady();
  }

  function flushCompletedTransfers() {
    for (const [transferId, transfer] of transfersRef.current.entries()) {
      if (transfer.chunks.size === transfer.totalPackets) {
        void finalizeTransfer(transferId);
      }
    }
  }

  async function finalizeTransfer(transferId) {
    const transfer = transfersRef.current.get(transferId);
    if (!transfer) return;
    if (transfer.encrypted && !sessionKeyRef.current) return;
    if (transfer.chunks.size !== transfer.totalPackets) return;

    const ordered = Array.from({ length: transfer.totalPackets }, (_, index) => transfer.chunks.get(index));
    const payload = concatBytes(ordered);
    const metadata = decodeJson(transfer.metadata);
    const plainBytes = await maybeDecryptBytes(payload, sessionKeyRef.current, transfer.encrypted);

    if (metadata.kind === "message") {
      setReceivedMessages((current) => [
        {
          id: `${transferId}-${Date.now()}`,
          text: decodeString(plainBytes),
          encrypted: transfer.encrypted,
        },
        ...current,
      ]);
    } else {
      const blob = new Blob([plainBytes], { type: metadata.mimeType });
      const url = URL.createObjectURL(blob);
      setIncomingFiles((current) => [
        {
          id: `${transferId}-${Date.now()}`,
          label: metadata.label,
          mimeType: metadata.mimeType,
          size: plainBytes.length,
          encrypted: transfer.encrypted,
          url,
          preview: metadata.mimeType.startsWith("image/") ? encodeBlobUrl(plainBytes) : "",
        },
        ...current,
      ]);
    }

    transfersRef.current.delete(transferId);
  }

  const attachLocalVideo = useCallback((node) => {
    localVideoRef.current = node;
    if (!node || !localStreamRef.current) return;
    node.srcObject = localStreamRef.current;
    playMedia(node, "local video");
  }, []);

  const attachRemoteVideo = useCallback((node) => {
    remoteVideoRef.current = node;
    if (!node) return;
    syncRemoteVideo();
  }, []);

  const attachRemoteAudio = useCallback((node) => {
    remoteAudioRef.current = node;
    if (!node) return;
    node.autoplay = true;
    node.defaultMuted = false;
    node.muted = false;
    node.volume = 1;
    syncRemoteVideo();
  }, []);

  function syncLocalVideo() {
    const localVideo = localVideoRef.current;
    if (!localVideo || !localStreamRef.current) return;
    if (localVideo.srcObject !== localStreamRef.current) {
      localVideo.srcObject = localStreamRef.current;
    }
    playMedia(localVideo, "local video");
  }

  function syncRemoteVideo() {
    const remoteVideo = remoteVideoRef.current;
    const remoteAudio = remoteAudioRef.current;
    const remoteStream = remoteStreamRef.current;
    const hasRemoteVideo = Boolean(remoteStream?.getVideoTracks().length);
    const hasRemoteAudio = Boolean(remoteStream?.getAudioTracks().length);
    if (!remoteVideo) {
      setRemoteReady(hasRemoteVideo);
    } else {
      if (remoteVideo.srcObject !== remoteStream) {
        remoteVideo.srcObject = remoteStream ?? null;
      }
      if (hasRemoteVideo) {
        playMedia(remoteVideo, "remote video");
      }
    }
    if (remoteAudio) {
      if (remoteAudio.srcObject !== remoteStream) {
        remoteAudio.srcObject = remoteStream ?? null;
      }
      if (hasRemoteAudio) {
        playMedia(remoteAudio, "remote audio");
      }
    }
    setRemoteReady(hasRemoteVideo);
  }

  function closePeerConnection() {
    if (!peerRef.current) return;
    peerRef.current.connection.onicecandidate = null;
    peerRef.current.connection.onnegotiationneeded = null;
    peerRef.current.connection.ontrack = null;
    peerRef.current.connection.onconnectionstatechange = null;
    peerRef.current.connection.close();
    peerRef.current = null;
    setCallActive(false);
  }

  function resetRemoteStream() {
    remoteStreamRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setPeerConnected(false);
    setRemoteReady(false);
  }

  function stopLocalCamera() {
    if (!localStreamRef.current) return;
    localStreamRef.current.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }

  function leaveCall(returnTo = "lobby") {
    closePeerConnection();
    resetRemoteStream();
    setStatus(returnTo === "landing" ? "" : "Call ended.");
    setView(returnTo);
  }

  function goHome() {
    closePeerConnection();
    resetRemoteStream();
    stopLocalCamera();
    setStatus("");
    setView("landing");
  }

  function setupSenderTransform(sender) {
    if (!sender || senderTransformsRef.current.has(sender)) return;
    if (typeof sender.createEncodedStreams !== "function") {
      setStatus("Encoded video transforms are not supported in this browser.");
      return;
    }

    const { readable, writable } = sender.createEncodedStreams();
    const transform = new TransformStream({
      transform: (frame, controller) => {
        const queued = queueRef.current[0];
        if (queued) {
          const ok = appendPacketToEncodedFrame(frame, queued.packet);
          if (ok) {
            queued.roundsLeft -= 1;
            if (queued.roundsLeft <= 0) {
              queueRef.current.shift();
            }
            if (!queued.accounted) {
              queued.accounted = true;
              setOutgoingTransfers((current) =>
                current.map((item) =>
                  item.transferId === queued.transferId
                    ? { ...item, sentPackets: Math.min(item.sentPackets + 1, item.totalPackets) }
                    : item,
                ),
              );
            }
            setMetrics((current) => ({
              ...current,
              packetsEmbedded: current.packetsEmbedded + 1,
              queueDepth: queueRef.current.length,
              payloadOverhead: Number(
                ((queued.packet.byteLength / Math.max(1, frame.data.byteLength)) * 100).toFixed(2),
              ),
            }));
          }
        } else {
          setMetrics((current) => ({ ...current, queueDepth: 0 }));
        }
        controller.enqueue(frame);
      },
    });

    readable.pipeThrough(transform).pipeTo(writable);
    senderTransformsRef.current.add(sender);
  }

  function setupReceiverTransform(receiver) {
    if (!receiver || receiverTransformsRef.current.has(receiver)) return;
    if (typeof receiver.createEncodedStreams !== "function") {
      setStatus("Encoded video transforms are not supported in this browser.");
      return;
    }

    const { readable, writable } = receiver.createEncodedStreams();
    const transform = new TransformStream({
      transform: async (frame, controller) => {
        const packet = extractPacketFromEncodedFrame(frame);
        if (packet) {
          await processIncomingPacket(packet);
          setMetrics((current) => ({
            ...current,
            packetsRecovered: current.packetsRecovered + 1,
          }));
        }
        controller.enqueue(frame);
      },
    });

    readable.pipeThrough(transform).pipeTo(writable);
    receiverTransformsRef.current.add(receiver);
  }

  async function ensurePeerConnection(polite, targetRoom) {
    if (peerRef.current) return peerRef.current;
    if (!localStreamRef.current) return null;

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      encodedInsertableStreams: true,
    });

    const peer = {
      connection,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
    };

    connection.onicecandidate = ({ candidate }) => {
      signaling.emit("signal", { roomCode: targetRoom, candidate });
    };

    connection.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await connection.setLocalDescription(await connection.createOffer());
        signaling.emit("signal", {
          roomCode: targetRoom,
          description: connection.localDescription,
        });
      } finally {
        peer.makingOffer = false;
      }
    };

    connection.ontrack = (event) => {
      const incomingStream = event.streams?.[0];
      if (incomingStream) {
        remoteStreamRef.current = incomingStream;
      } else {
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        if (!remoteStreamRef.current.getTracks().some((track) => track.id === event.track.id)) {
          remoteStreamRef.current.addTrack(event.track);
        }
      }
      if (event.track.kind === "video") {
        setupReceiverTransform(event.receiver);
      }
      event.track.onended = () => {
        if (!incomingStream) {
          remoteStreamRef.current?.removeTrack(event.track);
        }
        syncRemoteVideo();
      };
      syncRemoteVideo();
    };
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      setStatus(`Peer state: ${state}`);
      setCallActive(state === "connected");
      setPeerConnected(state === "connected");
      if (["failed", "closed", "disconnected"].includes(state)) {
        remoteStreamRef.current = null;
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = null;
        }
        setPeerConnected(false);
    setRemoteReady(false);
      }
    };

    localStreamRef.current.getVideoTracks().forEach((track) => {
      const sender = connection.addTrack(track, localStreamRef.current);
      setupSenderTransform(sender);
    });

    localStreamRef.current.getAudioTracks().forEach((track) => {
      connection.addTrack(track, localStreamRef.current);
    });

    peerRef.current = peer;
    return peer;
  }

  async function startCamera() {
    const trimmedRoomCode = roomCode.trim();
    if (!trimmedRoomCode) {
      setStatus("Enter a room ID to continue.");
      return;
    }

    if (trimmedRoomCode !== roomCode) {
      setRoomCode(trimmedRoomCode);
    }
    roomCodeRef.current = trimmedRoomCode;
    setView("lobby");

    if (localStreamRef.current) {
      setStatus("");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);
    localStreamRef.current = stream;
    syncLocalVideo();
    setStatus("");
  }

  async function joinCall() {
    const trimmedRoomCode = roomCode.trim();
    if (!trimmedRoomCode) {
      setStatus("Enter a room ID to continue.");
      return;
    }

    if (!localStreamRef.current) {
      await startCamera();
    }

    remoteStreamRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setPeerConnected(false);
    setRemoteReady(false);
    resetSessionCrypto();
    setView("call");
    roomCodeRef.current = trimmedRoomCode;
    signaling.emit("join-room", { roomCode: trimmedRoomCode });
  }

  async function sendMessage() {
    if (!peerConnected) {
      setStatus("Wait for the remote peer to join before sending hidden data.");
      return;
    }
    if (!message.trim()) return;
    const metadata = encodeJson({
      label: "Secret message",
      mimeType: "text/plain",
      kind: "message",
      createdAt: new Date().toISOString(),
    });
    const sessionKey = sessionKeyRef.current;
    if (!sessionKey) {
      setStatus("Waiting for secure session key exchange.");
      return;
    }

    const encryptedPayload = await maybeEncryptBytes(encodeString(message.trim()), sessionKey);
    enqueueTransfer({
      type: 1,
      label: "Message",
      payload: encryptedPayload.data,
      metadata,
      encrypted: encryptedPayload.encrypted,
    });
    setMessage("");
  }

  async function sendFile(file) {
    if (!peerConnected) {
      setStatus("Wait for the remote peer to join before sending hidden data.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const metadata = encodeJson({
      label: file.name,
      mimeType: file.type || "application/octet-stream",
      kind: "file",
      size: bytes.length,
      createdAt: new Date().toISOString(),
    });
    const sessionKey = sessionKeyRef.current;
    if (!sessionKey) {
      setStatus("Waiting for secure session key exchange.");
      return;
    }

    const encryptedPayload = await maybeEncryptBytes(bytes, sessionKey);
    enqueueTransfer({
      type: 2,
      label: file.name,
      payload: encryptedPayload.data,
      metadata,
      encrypted: encryptedPayload.encrypted,
    });
  }

  function enqueueTransfer({ type, label, payload, metadata, encrypted }) {
    const transferId = nextTransferIdRef.current;
    nextTransferIdRef.current = (nextTransferIdRef.current % 65535) + 1;
    const packets = packetizeTransfer(transferId, type, payload, metadata, encrypted);
    const scheduled = [];

    for (let round = 0; round < PACKET_REPEAT_ROUNDS; round += 1) {
      for (let index = 0; index < packets.length; index += 1) {
        scheduled.push({
          packet: packets[index],
          transferId,
          label,
          packetIndex: index + 1,
          totalPackets: packets.length,
          roundsLeft: 1,
          accounted: round > 0,
        });
      }
    }

    queueRef.current.push(...scheduled);
    setOutgoingTransfers((current) => [
      { transferId, label, totalPackets: packets.length, sentPackets: 0 },
      ...current.filter((item) => item.transferId !== transferId),
    ]);
    setMetrics((current) => ({ ...current, queueDepth: queueRef.current.length }));
  }

  async function processIncomingPacket(packetBytes) {
    const packet = unpackPacket(packetBytes);
    if (!packet) return;

    const dedupeKey = `${packet.transferId}:${packet.packetIndex}`;
    if (extractorSeenRef.current.has(dedupeKey)) return;
    extractorSeenRef.current.add(dedupeKey);

    const transfer = transfersRef.current.get(packet.transferId) ?? {
      type: packet.type,
      encrypted: packet.encrypted,
      totalPackets: packet.totalPackets,
      chunks: new Map(),
      metadata: packet.metadata,
    };

    if (packet.metadata.length > 0) {
      transfer.metadata = packet.metadata;
    }

    transfer.chunks.set(packet.packetIndex, packet.payload);
    transfersRef.current.set(packet.transferId, transfer);
    if (transfer.chunks.size !== transfer.totalPackets) return;

    const ordered = Array.from({ length: transfer.totalPackets }, (_, index) => transfer.chunks.get(index));
    const payload = concatBytes(ordered);
    const metadata = decodeJson(transfer.metadata);
    if (transfer.encrypted && !sessionKeyRef.current) return;

    const plainBytes = await maybeDecryptBytes(payload, sessionKeyRef.current, transfer.encrypted);

    if (metadata.kind === "message") {
      setReceivedMessages((current) => [
        {
          id: `${packet.transferId}-${Date.now()}`,
          text: decodeString(plainBytes),
          encrypted: transfer.encrypted,
        },
        ...current,
      ]);
    } else {
      const blob = new Blob([plainBytes], { type: metadata.mimeType });
      const url = URL.createObjectURL(blob);
      setIncomingFiles((current) => [
        {
          id: `${packet.transferId}-${Date.now()}`,
          label: metadata.label,
          mimeType: metadata.mimeType,
          size: plainBytes.length,
          encrypted: transfer.encrypted,
          url,
          preview: metadata.mimeType.startsWith("image/") ? encodeBlobUrl(plainBytes) : "",
        },
        ...current,
      ]);
    }

    transfersRef.current.delete(packet.transferId);
  }

  const showSupportPanels = view === "call";
  const transfersEnabled = peerConnected;

  return (
    <div className="page-shell app-shell">
      {view === "landing" ? (
        <section className="landing-stage">
          <div className="landing-copy">
            <p className="eyebrow">Peer-to-peer encoded media covert transfer</p>
            <h1>Cipher<br />Stream</h1>
          </div>
          <div className="landing-card">
            <Card className="border-white/10 bg-[#0f172a]/80 p-6">
              <CardHeader className="mb-4">
                <CardTitle>Enter session</CardTitle>
              </CardHeader>
              <CardContent>
                <label className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                  Room ID
                  <Input
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    placeholder="e.g. room-alpha-7"
                    onKeyDown={(e) => e.key === "Enter" && startCamera()}
                  />
                </label>
                <Button className="w-full" onClick={startCamera}>Continue</Button>
                <p className="status-line">{status}</p>
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

      {view === "lobby" ? (
        <section className="stage-panel lobby-stage-panel">
          <div className="lobby-grid">
            <div className="lobby-preview-panel">
              <div className="lobby-preview-copy">
                <p className="eyebrow">Camera preview</p>
                <h2>Camera</h2>
              </div>
              <div className="single-video-wrap lobby-video-wrap">
                <video
                  ref={attachLocalVideo}
                  autoPlay
                  muted
                  playsInline
                  className="video-frame hero-video local-preview"
                />
              </div>
            </div>

            <aside className="lobby-side-panel">
              <Card className="w-full p-5">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <div className="room-pill self-start">{roomCode}</div>
                    <h3 className="text-lg font-semibold text-white">Room</h3>
                  </div>
                  <Separator />
                  <div className="flex flex-col gap-2">
                    <span className="status-line">{status}</span>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={joinCall}>Enter</Button>
                      <Button variant="secondary" onClick={goHome}>Back</Button>
                    </div>
                  </div>
                </div>
              </Card>
            </aside>
          </div>
        </section>
      ) : null}

      {view === "call" ? (
        <>
          <section className="stage-panel">
            <div className="stage-header">
              <div>
                <p className="eyebrow">Live session</p>
                <h2>Call</h2>
              </div>
              <div className="header-actions">
                <div className="room-pill">{joinedRoom || roomCode}</div>
                <Button variant="secondary" onClick={() => leaveCall("lobby")}>Leave call</Button>
              </div>
            </div>

            <div className="call-grid two-up">
              <Card className="call-card p-4">
                <div className="call-card-header">
                  <h3>You</h3>
                  <Badge variant="secondary">Local feed</Badge>
                </div>
                <video
                  ref={attachLocalVideo}
                  autoPlay
                  muted
                  playsInline
                  className="video-frame hero-video local-preview"
                />
              </Card>

              <Card className="call-card remote-card p-4">
                <div className="call-card-header">
                  <h3>Remote peer</h3>
                  <Badge variant={peerConnected ? "success" : "secondary"}>
                    {peerConnected ? "Connected" : "Waiting..."}
                  </Badge>
                </div>
                <video
                  ref={attachRemoteVideo}
                  autoPlay
                  playsInline
                  className="video-frame hero-video local-preview"
                />
                <audio
                  ref={attachRemoteAudio}
                  autoPlay
                  playsInline
                  hidden
                />
                {!peerConnected ? (
                  <div className="waiting-overlay">Waiting for remote peer to join</div>
                ) : null}
              </Card>
            </div>
          </section>

          {showSupportPanels ? (
            <div className="support-stack">
              <div className="support-grid top-grid">
                <section className="panel">
                  <div className="panel-header">
                    <h2>Hidden message</h2>
                  </div>
                  <Textarea
                    rows="5"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={!transfersEnabled}
                    placeholder="Type a covert message..."
                  />
                  <Button onClick={sendMessage} disabled={!transfersEnabled}>Embed &amp; send</Button>
                </section>

                <section className="panel panel-fixed panel-hidden-file">
                  <div className="panel-header">
                    <h2>Hidden file</h2>
                  </div>
                  <label className={`file-picker${transfersEnabled ? "" : " is-disabled"}`}>
                    <input
                      type="file"
                      disabled={!transfersEnabled}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) sendFile(file);
                      }}
                    />
                    Select file to embed
                  </label>
                  <div className="transfer-list transfer-list-scroll">
                    {outgoingTransfers.map((item) => (
                      <div key={item.transferId} className="transfer-card">
                        <strong>{item.label}</strong>
                        <span>{item.sentPackets} / {item.totalPackets} packets transmitted</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="support-grid bottom-grid">
                <section className="panel">
                  <div className="panel-header">
                    <h2>Performance</h2>
                    <span>Live metrics</span>
                  </div>
                  <div className="metric-grid">
                    <div className="metric-card">
                      <strong>{metrics.fps}</strong>
                      <span>Camera FPS</span>
                    </div>
                    <div className="metric-card">
                      <strong>{metrics.latencyMs}</strong>
                      <span>Latency ms</span>
                    </div>
                    <div className="metric-card">
                      <strong>{metrics.payloadOverhead}</strong>
                      <span>Payload overhead %</span>
                    </div>
                    <div className="metric-card">
                      <strong>{metrics.packetsEmbedded}</strong>
                      <span>Packets embedded</span>
                    </div>
                  </div>
                </section>

                <section className="panel panel-fixed panel-recovered-messages">
                  <div className="panel-header">
                    <h2>Recovered messages</h2>
                    <span>{receivedMessages.length} complete</span>
                  </div>
                  <div className="transfer-list transfer-list-scroll">
                    {receivedMessages.length === 0
                      ? <p className="empty">No messages recovered yet.</p>
                      : receivedMessages.map((item) => (
                        <div key={item.id} className="transfer-card">
                          <strong>{item.encrypted ? "Encrypted" : "Message"}</strong>
                          <span>{item.text}</span>
                        </div>
                      ))}
                  </div>
                </section>

                <section className="panel panel-fixed panel-recovered-files">
                  <div className="panel-header">
                    <h2>Recovered files</h2>
                    <span>{incomingFiles.length} ready</span>
                  </div>
                  <div className="transfer-list transfer-list-scroll">
                    {incomingFiles.length === 0
                      ? <p className="empty">No files recovered yet.</p>
                      : incomingFiles.map((item) => (
                        <div key={item.id} className="transfer-card">
                          <strong>{item.label}</strong>
                          <span>{formatBytes(item.size)} | {item.encrypted ? "encrypted" : "plain"}</span>
                          {item.preview ? (
                            <img className="preview-image" alt={item.label} src={`data:${item.mimeType};base64,${item.preview}`} />
                          ) : null}
                          <a href={item.url} download={item.label}>Download</a>
                        </div>
                      ))}
                  </div>
                </section>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}









