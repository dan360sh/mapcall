// WebRTC call logic
//
// Flow: callee creates offer (they have the camera), caller answers.
// DataChannel created by callee; caller sends joystick events through it.
// Caller's microphone is never added → caller cannot speak.

import { send, on } from './signaling.js';
import { initJoystick, destroyJoystick } from './joystick.js';
import { showArrow } from './arrows.js';

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

let pc = null;
let localStream = null;
let dataChannel = null; // caller uses this to send joystick events
let peerId = null;
let onHangupCb = null;

export function initCall(opts = {}) {
  onHangupCb = opts.onHangup;

  // ── Caller receives WebRTC offer from callee ──────────────────────────────
  on('webrtc-offer', async ({ from, sdp }) => {
    peerId = from;
    pc = buildPC('caller');
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send('webrtc-answer', { to: from, sdp: answer.sdp });
  });

  // ── Callee receives answer from caller ────────────────────────────────────
  on('webrtc-answer', async ({ sdp }) => {
    if (pc?.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    }
  });

  // ── ICE candidates ────────────────────────────────────────────────────────
  on('webrtc-ice', async ({ candidate }) => {
    if (candidate && pc) {
      await pc.addIceCandidate(candidate).catch(() => {});
    }
  });

  // ── Server tells callee to start WebRTC ───────────────────────────────────
  on('start-webrtc', ({ callerId }) => {
    peerId = callerId;
    startAsCallee(callerId);
  });
}

// ── Callee: get camera, create offer ─────────────────────────────────────────
async function startAsCallee(callerId) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false, // no audio on either side — caller is muted by design
    });
  } catch (err) {
    console.error('Camera access denied:', err);
    send('hangup', { to: callerId });
    cleanUp();
    onHangupCb?.();
    return;
  }

  pc = buildPC('callee');

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  // DataChannel for joystick events (caller sends, callee receives)
  dataChannel = pc.createDataChannel('joystick');
  dataChannel.onmessage = (e) => {
    const { dir } = JSON.parse(e.data);
    showArrow(dir);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send('webrtc-offer', { to: callerId, sdp: offer.sdp });
}

// ── Build RTCPeerConnection ───────────────────────────────────────────────────
function buildPC(role) {
  const peer = new RTCPeerConnection(ICE);

  peer.onicecandidate = ({ candidate }) => {
    if (candidate) send('webrtc-ice', { to: peerId, candidate });
  };

  peer.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
      cleanUp();
      onHangupCb?.();
    }
  };

  if (role === 'caller') {
    // Caller sees callee's video
    peer.ontrack = ({ streams }) => {
      const vid = document.getElementById('remote-video');
      if (vid && streams[0]) vid.srcObject = streams[0];
    };

    // Caller gets DataChannel → send joystick events
    peer.ondatachannel = ({ channel }) => {
      dataChannel = channel;
      initJoystick((dir) => {
        if (dataChannel?.readyState === 'open') {
          dataChannel.send(JSON.stringify({ dir }));
        }
      });
    };
  }

  return peer;
}

// ── Public API ────────────────────────────────────────────────────────────────
export function acceptCall(callerId) {
  peerId = callerId;
  send('call-accept', { callerId });
  // start-webrtc event will trigger startAsCallee()
}

export function endCall() {
  if (peerId) send('hangup', { to: peerId });
  cleanUp();
}

function cleanUp() {
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  dataChannel = null;
  if (pc) { pc.close(); pc = null; }
  peerId = null;
  destroyJoystick();
  const vid = document.getElementById('remote-video');
  if (vid) vid.srcObject = null;
}
