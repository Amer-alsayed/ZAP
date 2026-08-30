import { useState, useRef, useEffect, useCallback } from 'react';
import { soundEngine } from '../services/soundEffects';
import { 
  getSocket, 
  emitStartGroupCall, 
  emitJoinGroupCall, 
  emitLeaveGroupCall, 
  emitGroupCallSignal, 
  emitGroupCallState 
} from '../services/socket';
import { useIceServers } from '../utils/webrtcConfig';

export function useGroupCalls({
  currentUser,
  groupsRef,
  activeGroupRef,
  callStateRef,
  showToast
}) {
  const { iceServers } = useIceServers();
  const pcConfig = { iceServers };

  const [gcState, setGcStateInternal] = useState('idle'); // idle | calling | ringing | connected
  const gcStateRef = useRef('idle');
  const setGcState = useCallback((val) => {
    setGcStateInternal(val);
    gcStateRef.current = val;
  }, []);

  const [gcGroupId, setGcGroupIdInternal] = useState(null);
  const gcGroupIdRef = useRef(null);
  const setGcGroupId = useCallback((gid) => {
    setGcGroupIdInternal(gid);
    gcGroupIdRef.current = gid;
  }, []);

  const [gcMediaType, setGcMediaTypeInternal] = useState('voice'); // voice | video
  const gcMediaTypeRef = useRef('voice');
  const setGcMediaType = useCallback((mt) => {
    setGcMediaTypeInternal(mt);
    gcMediaTypeRef.current = mt;
  }, []);

  const gcIsInitiatorRef = useRef(false);

  const [gcRemoteStreams, setGcRemoteStreams] = useState({});
  const gcRemoteStreamsRef = useRef({});
  const [gcPeers, setGcPeers] = useState({});
  const gcPeersRef = useRef({});
  const [gcElapsed, setGcElapsed] = useState(0);
  const [gcMinimized, setGcMinimized] = useState(false);

  // Group call media states
  const [localStream, setLocalStreamInternal] = useState(null);
  const localStreamRef = useRef(null);
  const setLocalStream = useCallback((val) => {
    setLocalStreamInternal(val);
    localStreamRef.current = val;
  }, []);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const gcPcs = useRef({});
  const gcIceQueues = useRef({});
  const dummyTrackRef = useRef(null);
  const originalVideoTrackRef = useRef(null);

  // Group call sound effects
  useEffect(() => {
    if (gcState === 'calling') {
      soundEngine.stopIncomingRingtone();
      soundEngine.startOutgoingRingTone();
    } else if (gcState === 'ringing') {
      soundEngine.stopOutgoingRingTone();
      soundEngine.startIncomingRingtone();
    } else if (gcState === 'connected') {
      soundEngine.stopOutgoingRingTone();
      soundEngine.stopIncomingRingtone();
      soundEngine.playCallConnected();
    } else if (gcState === 'idle') {
      soundEngine.stopOutgoingRingTone();
      soundEngine.stopIncomingRingtone();
    }
  }, [gcState]);

  // Group call duration counter
  useEffect(() => {
    if (gcState !== 'connected') return;
    const interval = setInterval(() => setGcElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [gcState]);

  const optimizeSDP = useCallback((sdp) => {
    try {
      const quality = localStorage.getItem('zap_call_quality') || localStorage.getItem('chatra_call_quality') || 'medium';
      let audioBitrate = 64000;
      let isStereo = '1';
      let minVideoBitrate = 1500;
      let maxVideoBitrate = 4000;
      let startVideoBitrate = 2500;

      if (quality === 'high') {
        audioBitrate = 128000;
        isStereo = '1';
        minVideoBitrate = 2500;
        maxVideoBitrate = 6000;
        startVideoBitrate = 4000;
      } else if (quality === 'low') {
        audioBitrate = 24000;
        isStereo = '0';
        minVideoBitrate = 300;
        maxVideoBitrate = 1000;
        startVideoBitrate = 500;
      }

      const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
      let modified = sdp;
      if (opusMatch) {
        const opusPayloadType = opusMatch[1];
        const fmtpRegex = new RegExp(`(a=fmtp:${opusPayloadType} [^\r\n]*)`, 'i');
        if (modified.match(fmtpRegex)) {
          modified = modified.replace(
            fmtpRegex,
            `$1;stereo=${isStereo};sprop-stereo=${isStereo};maxaveragebitrate=${audioBitrate};cbr=1;useinbandfec=1;minptime=10;ptime=10`
          );
        } else {
          const rtpmapRegex = new RegExp(`(a=rtpmap:${opusPayloadType} opus\\/48000\\/2[^\r\n]*)`, 'i');
          modified = modified.replace(
            rtpmapRegex,
            `$1\r\na=fmtp:${opusPayloadType} stereo=${isStereo};sprop-stereo=${isStereo};maxaveragebitrate=${audioBitrate};cbr=1;useinbandfec=1;minptime=10;ptime=10`
          );
        }
      }
      
      if (modified.includes('m=video')) {
        modified = modified.replace(
          /a=rtpmap:(\d+) (VP8|VP9|H264)\/90000/gi,
          `a=rtpmap:$1 $2/90000\r\na=fmtp:$1 x-google-min-bitrate=${minVideoBitrate};x-google-max-bitrate=${maxVideoBitrate};x-google-start-bitrate=${startVideoBitrate}`
        );
      }
      return modified;
    } catch (e) {
      console.warn("Failed to optimize SDP:", e);
      return sdp;
    }
  }, []);

  const optimizeSenderParameters = useCallback(async (sender, isScreenShare) => {
    try {
      const quality = localStorage.getItem('zap_call_quality') || localStorage.getItem('chatra_call_quality') || 'medium';
      const parameters = sender.getParameters();
      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }

      let maxBitrate = 1800000;
      let priority = 'medium';

      if (isScreenShare) {
        if (quality === 'high') {
          maxBitrate = 3000000;
          priority = 'high';
        } else if (quality === 'low') {
          maxBitrate = 800000;
          priority = 'low';
        } else {
          maxBitrate = 2000000;
          priority = 'high';
        }
      } else {
        if (quality === 'high') {
          maxBitrate = 3000000;
          priority = 'high';
        } else if (quality === 'low') {
          maxBitrate = 500000;
          priority = 'low';
        } else {
          maxBitrate = 1500000;
          priority = 'medium';
        }
      }

      parameters.encodings[0].maxBitrate = maxBitrate;
      parameters.encodings[0].priority = priority;
      parameters.encodings[0].networkPriority = priority;
      await sender.setParameters(parameters);
    } catch (e) {
      console.warn("Failed to set RtpSender parameters:", e);
    }
  }, []);

  const getAudioConstraints = useCallback(() => {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
      latency: { ideal: 0.005, max: 0.02 }
    };
  }, []);

  const getVideoConstraints = useCallback(() => {
    const quality = localStorage.getItem('zap_call_quality') || localStorage.getItem('chatra_call_quality') || 'medium';
    if (quality === 'high') {
      return {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30 }
      };
    } else if (quality === 'low') {
      return {
        width: { ideal: 640 },
        height: { ideal: 480 },
        aspectRatio: { ideal: 4 / 3 },
        frameRate: { ideal: 15 }
      };
    } else {
      return {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 30 }
      };
    }
  }, []);

  const getScreenShareConstraints = useCallback(() => {
    const quality = localStorage.getItem('zap_call_quality') || localStorage.getItem('chatra_call_quality') || 'medium';
    if (quality === 'high') {
      return {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        displaySurface: 'monitor',
        selfBrowserSurface: 'exclude'
      };
    } else if (quality === 'low') {
      return {
        frameRate: { ideal: 15, max: 15 },
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        displaySurface: 'monitor',
        selfBrowserSurface: 'exclude'
      };
    } else {
      return {
        frameRate: { ideal: 30, max: 30 },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        displaySurface: 'monitor',
        selfBrowserSurface: 'exclude'
      };
    }
  }, []);

  const createDummyVideoTrack = useCallback(() => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#cccccc';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Voice Call', 320, 240);
      const stream = canvas.captureStream(1);
      const track = stream.getVideoTracks()[0];
      track.enabled = false;
      return track;
    } catch (e) {
      console.error('Failed to create dummy canvas track:', e);
      return null;
    }
  }, []);

  const gcEmitMyState = useCallback(() => {
    if (!gcGroupIdRef.current) return;
    emitGroupCallState(gcGroupIdRef.current, {
      muted: isMuted,
      cameraOff: isCameraOff,
      screenSharing: isScreenSharing
    });
  }, [isCameraOff, isMuted, isScreenSharing]);

  const gcFlushIce = useCallback(async (peerLower) => {
    const pc = gcPcs.current[peerLower];
    const queue = gcIceQueues.current[peerLower] || [];
    if (pc && pc.remoteDescription) {
      while (queue.length > 0) {
        const cand = queue.shift();
        try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
      }
    }
  }, []);

  const gcRemovePeer = useCallback((peerLower) => {
    const pc = gcPcs.current[peerLower];
    if (pc) {
      try { pc.close(); } catch (e) {}
      delete gcPcs.current[peerLower];
    }
    delete gcIceQueues.current[peerLower];
    if (gcRemoteStreamsRef.current[peerLower]) {
      const nextStreams = { ...gcRemoteStreamsRef.current };
      delete nextStreams[peerLower];
      gcRemoteStreamsRef.current = nextStreams;
      setGcRemoteStreams(nextStreams);
    }
    if (gcPeersRef.current[peerLower]) {
      const nextPeers = { ...gcPeersRef.current };
      delete nextPeers[peerLower];
      gcPeersRef.current = nextPeers;
      setGcPeers(nextPeers);
    }
  }, []);

  const gcCreatePC = useCallback((peerLower) => {
    if (gcPcs.current[peerLower]) return gcPcs.current[peerLower];

    const pc = new RTCPeerConnection(pcConfig);
    gcPcs.current[peerLower] = pc;
    gcIceQueues.current[peerLower] = [];

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current);
    });

    pc.ontrack = (event) => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      gcRemoteStreamsRef.current = { ...gcRemoteStreamsRef.current, [peerLower]: stream };
      setGcRemoteStreams(gcRemoteStreamsRef.current);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        emitGroupCallSignal({ to: peerLower, groupId: gcGroupIdRef.current, kind: 'ice', data: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        gcRemovePeer(peerLower);
      }
    };

    return pc;
  }, [gcRemovePeer, pcConfig]);

  const gcOfferTo = useCallback(async (peerLower) => {
    try {
      const pc = gcCreatePC(peerLower);
      if (pc.signalingState !== 'stable') return;

      const offer = await pc.createOffer();
      offer.sdp = optimizeSDP(offer.sdp);
      await pc.setLocalDescription(offer);

      const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (videoSender && gcMediaTypeRef.current === 'video') {
        optimizeSenderParameters(videoSender, false).catch(() => {});
      }

      emitGroupCallSignal({ to: peerLower, groupId: gcGroupIdRef.current, kind: 'offer', data: { sdp: offer.sdp } });
    } catch (err) {
      console.error('Failed to create group call offer:', err);
    }
  }, [gcCreatePC, optimizeSDP, optimizeSenderParameters]);

  const gcAcquireMedia = useCallback(async (mediaType) => {
    let stream;
    let effective = mediaType;
    try {
      if (mediaType === 'video') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
            video: getVideoConstraints()
          });
          dummyTrackRef.current = null;
        } catch (videoErr) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints(), video: false });
          const dummyTrack = createDummyVideoTrack();
          if (dummyTrack) stream.addTrack(dummyTrack);
          dummyTrackRef.current = dummyTrack;
          effective = 'voice';
          showToast?.('No camera found. Joined with voice only.', 'info', 'Voice Fallback');
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: getAudioConstraints(), video: false });
        const dummyTrack = createDummyVideoTrack();
        if (dummyTrack) stream.addTrack(dummyTrack);
        dummyTrackRef.current = dummyTrack;
      }
    } catch (err) {
      console.error('Group call media acquisition failed:', err);
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        showToast?.('Microphone permission denied.', 'error', 'Permission Required');
      } else {
        showToast?.('Could not access microphone for the group call.', 'error', 'Device Error');
      }
      throw err;
    }
    return { stream, effective };
  }, [createDummyVideoTrack, getAudioConstraints, getVideoConstraints, showToast]);

  const gcCleanupAll = useCallback((notifyServer) => {
    if (notifyServer && gcGroupIdRef.current !== null) {
      emitLeaveGroupCall(gcGroupIdRef.current);
    }
    Object.values(gcPcs.current).forEach((pc) => {
      try { pc.close(); } catch (e) {}
    });
    gcPcs.current = {};
    gcIceQueues.current = {};
    gcRemoteStreamsRef.current = {};
    setGcRemoteStreams({});
    gcPeersRef.current = {};
    setGcPeers({});
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
      setLocalStream(null);
    }
    if (originalVideoTrackRef.current) {
      try { originalVideoTrackRef.current.stop(); } catch (e) {}
      originalVideoTrackRef.current = null;
    }
    if (dummyTrackRef.current) {
      try { dummyTrackRef.current.stop(); } catch (e) {}
      dummyTrackRef.current = null;
    }
    setGcGroupId(null);
    gcIsInitiatorRef.current = false;
    setGcMinimized(false);
    setGcElapsed(0);
    setGcState('idle');
    soundEngine.stopOutgoingRingTone();
    soundEngine.stopIncomingRingtone();
  }, [setGcGroupId, setGcState, setLocalStream]);

  const gcJoinFlow = useCallback(async (gid) => {
    try {
      const res = await emitJoinGroupCall(gid);
      if (res.error) throw new Error(res.error);

      setGcState('connected');

      const members = Array.isArray(res.members) ? res.members : [];
      for (const m of members) {
        await gcOfferTo(String(m).toLowerCase());
      }
    } catch (err) {
      console.error('Failed to join group call:', err);
      showToast?.(err.message || 'Failed to join the call.', 'error', 'Call Error');
      gcCleanupAll(true);
    }
  }, [gcCleanupAll, gcOfferTo, setGcState, showToast]);

  const handleStartGroupCall = useCallback(async (media) => {
    const group = activeGroupRef.current;
    if (!group || !currentUser) return;
    if (callStateRef?.current && callStateRef.current !== 'idle') {
      showToast?.('You are already in a call.', 'warning', 'Active Call');
      return;
    }
    if (gcStateRef.current !== 'idle') {
      showToast?.('You are already in a group call.', 'warning', 'Active Call');
      return;
    }

    let acquired;
    try {
      acquired = await gcAcquireMedia(media);
    } catch (err) {
      return;
    }

    setIsMuted(false);
    setIsScreenSharing(false);
    originalVideoTrackRef.current = null;
    setLocalStream(acquired.stream);

    const gid = group.id;
    setGcGroupId(gid);
    setGcMediaType(acquired.effective === 'voice' ? 'voice' : media);
    gcIsInitiatorRef.current = true;
    setGcPeers({});
    gcPeersRef.current = {};
    setGcElapsed(0);
    setGcMinimized(false);
    setGcState('calling');

    try {
      const res = await emitStartGroupCall(gid, gcMediaTypeRef.current);
      if (res.error === 'call_ongoing') {
        gcIsInitiatorRef.current = false;
        await gcJoinFlow(gid);
      } else if (res.error) {
        throw new Error(res.error);
      }
    } catch (err) {
      console.error('Failed to start group call:', err);
      gcCleanupAll(true);
    }
  }, [
    activeGroupRef,
    callStateRef,
    currentUser,
    gcAcquireMedia,
    gcCleanupAll,
    gcJoinFlow,
    setGcGroupId,
    setGcMediaType,
    setGcState,
    setLocalStream,
    showToast
  ]);

  const handleAcceptGroupCall = useCallback(async () => {
    const gid = gcGroupIdRef.current;
    if (!gid) return;
    try {
      const acquired = await gcAcquireMedia(gcMediaTypeRef.current);
      setLocalStream(acquired.stream);
      setIsMuted(false);
      setIsCameraOff(gcMediaTypeRef.current === 'voice' || acquired.effective === 'voice');
      setIsScreenSharing(false);
      originalVideoTrackRef.current = null;
      setGcState('connected');
      await gcJoinFlow(gid);
    } catch (err) {
      gcCleanupAll(false);
    }
  }, [gcAcquireMedia, gcCleanupAll, gcJoinFlow, setGcState, setLocalStream]);

  const handleDeclineGroupCall = useCallback(() => {
    gcCleanupAll(false);
  }, [gcCleanupAll]);

  const handleLeaveGroupCall = useCallback(() => {
    gcCleanupAll(true);
  }, [gcCleanupAll]);

  const handleGcToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      soundEngine.playToggleMute(!next);
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((t) => {
          t.enabled = !next;
        });
      }
      Object.values(gcPcs.current).forEach((pc) => {
        try {
          pc.getSenders().forEach((s) => {
            if (s.track && s.track.kind === 'audio') {
              s.track.enabled = !next;
            }
          });
        } catch (e) {}
      });
      emitGroupCallState(gcGroupIdRef.current, { muted: next, cameraOff: isCameraOff, screenSharing: isScreenSharing });
      return next;
    });
  }, [isCameraOff, isScreenSharing]);

  const gcReplaceVideoEverywhere = useCallback(async (track) => {
    for (const pc of Object.values(gcPcs.current)) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        try { await sender.replaceTrack(track); } catch (e) {}
      }
    }
  }, []);

  const gcStopScreenShare = useCallback(async () => {
    const stream = localStreamRef.current;

    if (stream) {
      stream.getVideoTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
        try { stream.removeTrack(t); } catch (e) {}
      });
    }

    let restored = originalVideoTrackRef.current;
    originalVideoTrackRef.current = null;

    let cameraRestored = false;
    if (restored && restored.readyState === 'live') {
      cameraRestored = true;
    } else {
      if (restored) { try { restored.stop(); } catch (e) {} }
      restored = createDummyVideoTrack();
      dummyTrackRef.current = restored;
    }

    if (stream && restored) {
      stream.addTrack(restored);
    }
    if (restored) {
      await gcReplaceVideoEverywhere(restored);
    }

    setIsScreenSharing(false);
    setIsCameraOff(!cameraRestored);
    setGcMediaType(cameraRestored ? 'video' : 'voice');
    if (stream) {
      setLocalStream(new MediaStream(stream.getTracks()));
    }
    emitGroupCallState(gcGroupIdRef.current, { muted: isMuted, cameraOff: !cameraRestored, screenSharing: false });
    return cameraRestored;
  }, [createDummyVideoTrack, gcReplaceVideoEverywhere, isMuted, setGcMediaType, setLocalStream]);

  const handleGcToggleCamera = useCallback(async () => {
    if (isScreenSharing) {
      await gcStopScreenShare();
      return;
    }

    const stream = localStreamRef.current;
    if (!stream) return;

    if (!isCameraOff) {
      stream.getVideoTracks().forEach((t) => {
        try { t.stop(); } catch (e) {}
        try { stream.removeTrack(t); } catch (e) {}
      });
      const dummyTrack = createDummyVideoTrack();
      if (dummyTrack) {
        dummyTrackRef.current = dummyTrack;
        stream.addTrack(dummyTrack);
        await gcReplaceVideoEverywhere(dummyTrack);
      } else {
        await gcReplaceVideoEverywhere(null);
      }
      setIsCameraOff(true);
      if (stream.getVideoTracks().length > 0) {
        setLocalStream(new MediaStream(stream.getTracks()));
      } else {
        setLocalStream(new MediaStream(stream.getAudioTracks()));
      }
      emitGroupCallState(gcGroupIdRef.current, { muted: isMuted, cameraOff: true, screenSharing: false });
      return;
    }

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: getVideoConstraints() });
      const cameraTrack = camStream.getVideoTracks()[0];
      if (!cameraTrack) throw new Error('No camera track');
      if ('contentHint' in cameraTrack) cameraTrack.contentHint = 'motion';

      if (dummyTrackRef.current) {
        try { dummyTrackRef.current.stop(); } catch (e) {}
        try { stream.removeTrack(dummyTrackRef.current); } catch (e) {}
        dummyTrackRef.current = null;
      }
      stream.addTrack(cameraTrack);
      await gcReplaceVideoEverywhere(cameraTrack);

      setGcMediaType('video');
      setIsCameraOff(false);
      setLocalStream(new MediaStream(stream.getTracks()));
      emitGroupCallState(gcGroupIdRef.current, { muted: isMuted, cameraOff: false, screenSharing: false });
    } catch (err) {
      showToast?.('Could not access camera device.', 'error', 'Camera Error');
    }
  }, [
    createDummyVideoTrack,
    gcReplaceVideoEverywhere,
    gcStopScreenShare,
    getVideoConstraints,
    isCameraOff,
    isMuted,
    isScreenSharing,
    setGcMediaType,
    setLocalStream,
    showToast
  ]);

  const handleGcToggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      await gcStopScreenShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showToast?.('Screen sharing is not supported by this browser/device.', 'warning', 'Screen Share');
      return;
    }

    try {
      let screenStream;
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: getScreenShareConstraints(), audio: false });
      } catch (err) {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      }
      const screenTrack = screenStream.getVideoTracks()[0];

      const stream = localStreamRef.current;
      const currentVideoTrack = stream?.getVideoTracks()[0];
      if (currentVideoTrack) {
        originalVideoTrackRef.current = currentVideoTrack;
        try { stream.removeTrack(currentVideoTrack); } catch (e) {}
      }
      screenTrack.onended = () => { gcStopScreenShare(); };

      stream?.addTrack(screenTrack);
      await gcReplaceVideoEverywhere(screenTrack);

      setIsScreenSharing(true);
      setGcMediaType('video');
      setLocalStream(stream ? new MediaStream(stream.getTracks()) : new MediaStream([screenTrack]));
      emitGroupCallState(gcGroupIdRef.current, { muted: isMuted, cameraOff: false, screenSharing: true });
    } catch (err) {
      console.error('Screen sharing failed:', err);
    }
  }, [
    gcReplaceVideoEverywhere,
    gcStopScreenShare,
    getScreenShareConstraints,
    isMuted,
    isScreenSharing,
    setGcMediaType,
    setLocalStream,
    showToast
  ]);

  // Socket event listeners for Group Calls
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !currentUser) return;

    const handleGcStarted = ({ groupId, from, mediaType }) => {
      if (String(from).toLowerCase() === currentUser.username.toLowerCase()) return;
      if (callStateRef?.current && callStateRef.current !== 'idle') {
        const groupName = groupsRef?.current?.find(g => g.id === groupId)?.name || 'a group';
        showToast?.(`${from} started a group call in "${groupName}".`, 'info', 'Missed Group Call');
        return;
      }
      if (gcStateRef.current !== 'idle') return;

      setGcGroupId(groupId);
      setGcMediaType(mediaType);
      gcIsInitiatorRef.current = false;
      setGcPeers({});
      gcPeersRef.current = {};
      setGcElapsed(0);
      setGcMinimized(false);
      setGcState('ringing');
    };

    const handleGcMember = ({ groupId, username: member }) => {
      if (!groupId || gcGroupIdRef.current !== groupId) return;
      const lower = String(member).toLowerCase();
      if (lower === currentUser.username.toLowerCase()) return;

      if (!gcPeersRef.current[lower]) {
        gcPeersRef.current = { ...gcPeersRef.current, [lower]: { muted: false, cameraOff: false, screenSharing: false } };
        setGcPeers(gcPeersRef.current);
      }
      if (gcIsInitiatorRef.current && gcStateRef.current === 'calling') {
        setGcState('connected');
      }
    };

    const handleGcSignal = async ({ groupId, from, kind, data: signalData }) => {
      try {
        if (!groupId || gcGroupIdRef.current !== groupId) return;
        const peerLower = String(from).toLowerCase();

        if (kind === 'offer') {
          let pc = gcPcs.current[peerLower] || gcCreatePC(peerLower);
          await pc.setRemoteDescription({ type: 'offer', sdp: optimizeSDP(signalData.sdp) });
          const answer = await pc.createAnswer();
          answer.sdp = optimizeSDP(answer.sdp);
          await pc.setLocalDescription(answer);
          emitGroupCallSignal({ to: peerLower, groupId, kind: 'answer', data: { sdp: answer.sdp } });
          await gcFlushIce(peerLower);
        } else if (kind === 'answer') {
          const pc = gcPcs.current[peerLower];
          if (!pc) return;
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription({ type: 'answer', sdp: signalData.sdp });
            await gcFlushIce(peerLower);
          }
        } else if (kind === 'ice') {
          const pc = gcPcs.current[peerLower];
          if (pc && pc.remoteDescription) {
            try { await pc.addIceCandidate(new RTCIceCandidate(signalData)); } catch (e) {}
          } else {
            (gcIceQueues.current[peerLower] = gcIceQueues.current[peerLower] || []).push(signalData);
          }
        }
      } catch (err) {
        console.error('Group call signal error:', err);
      }
    };

    const handleGcPeerState = ({ groupId, from, muted, cameraOff, screenSharing }) => {
      if (!groupId || gcGroupIdRef.current !== groupId) return;
      const lower = String(from).toLowerCase();
      if (lower === currentUser.username.toLowerCase()) return;
      gcPeersRef.current = {
        ...gcPeersRef.current,
        [lower]: { ...(gcPeersRef.current[lower] || {}), muted, cameraOff, screenSharing }
      };
      setGcPeers(gcPeersRef.current);
    };

    const handleGcLeft = ({ groupId, username: member }) => {
      if (!groupId || gcGroupIdRef.current !== groupId) return;
      gcRemovePeer(String(member).toLowerCase());
      if (gcStateRef.current === 'connected' && Object.keys(gcRemoteStreamsRef.current).length === 0 && gcIsInitiatorRef.current) {
        setGcState('calling');
      }
    };

    const handleGcEnded = () => {
      if (gcStateRef.current !== 'idle') {
        gcCleanupAll(false);
      }
    };

    socket.on('group-call-started', handleGcStarted);
    socket.on('group-call-member', handleGcMember);
    socket.on('group-call-signal', handleGcSignal);
    socket.on('group-call-peer-state', handleGcPeerState);
    socket.on('group-call-left', handleGcLeft);
    socket.on('group-call-ended', handleGcEnded);

    return () => {
      socket.off('group-call-started', handleGcStarted);
      socket.off('group-call-member', handleGcMember);
      socket.off('group-call-signal', handleGcSignal);
      socket.off('group-call-peer-state', handleGcPeerState);
      socket.off('group-call-left', handleGcLeft);
      socket.off('group-call-ended', handleGcEnded);
    };
  }, [
    callStateRef,
    currentUser,
    gcCleanupAll,
    gcCreatePC,
    gcFlushIce,
    gcRemovePeer,
    groupsRef,
    optimizeSDP,
    setGcGroupId,
    setGcMediaType,
    setGcState,
    showToast
  ]);

  return {
    gcState,
    setGcState,
    gcStateRef,
    gcGroupId,
    setGcGroupId,
    gcGroupIdRef,
    gcMediaType,
    setGcMediaType,
    gcMediaTypeRef,
    gcRemoteStreams,
    gcPeers,
    gcElapsed,
    gcMinimized,
    setGcMinimized,
    localStream,
    isMuted,
    isCameraOff,
    isScreenSharing,
    handleStartGroupCall,
    handleAcceptGroupCall,
    handleDeclineGroupCall,
    handleLeaveGroupCall,
    handleGcToggleMute,
    handleGcToggleCamera,
    handleGcToggleScreenShare,
    gcCleanupAll
  };
}

export default useGroupCalls;
