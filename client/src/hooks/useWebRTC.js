import { useState, useRef, useEffect, useCallback } from 'react';
import { soundEngine } from '../services/soundEffects';
import { getSocket } from '../services/socket';
import { useIceServers } from '../utils/webrtcConfig';

export function useWebRTC({
  currentUser,
  activeContact,
  contactsRef,
  gcStateRef,
  showToast,
  onSelectContact,
  onSendCallLog
}) {
  const { iceServers } = useIceServers();
  const pcConfig = { iceServers };

  const [callState, setCallStateInternal] = useState('idle'); // idle, calling, ringing, incoming, connected
  const callStateRef = useRef('idle');
  const setCallState = useCallback((val) => {
    setCallStateInternal(val);
    callStateRef.current = val;
  }, []);

  const [callMediaType, setCallMediaTypeInternal] = useState('voice'); // voice, video
  const callMediaTypeRef = useRef('voice');
  const setCallMediaType = useCallback((val) => {
    setCallMediaTypeInternal(val);
    callMediaTypeRef.current = val;
  }, []);

  const [callParty, setCallPartyInternal] = useState('');
  const callPartyRef = useRef('');
  const setCallParty = useCallback((val) => {
    setCallPartyInternal(val);
    callPartyRef.current = val;
  }, []);

  const [localStream, setLocalStreamInternal] = useState(null);
  const localStreamRef = useRef(null);
  const setLocalStream = useCallback((val) => {
    setLocalStreamInternal(val);
    localStreamRef.current = val;
  }, []);

  const [remoteStream, setRemoteStream] = useState(null);

  // Calling feature states
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [remoteScreenSharing, setRemoteScreenSharing] = useState(false);
  const [remoteCameraOff, setRemoteCameraOff] = useState(false);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState('user'); // 'user' | 'environment'
  const [isCallMinimized, setIsCallMinimized] = useState(false);

  // Internal WebRTC refs
  const isCallInitiator = useRef(false);
  const callStartTime = useRef(null);
  const peerConnectionRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
  const dummyTrackRef = useRef(null);
  const originalVideoTrackRef = useRef(null);
  const cameraDeviceIdRef = useRef(null);
  const selfieCameraDeviceIdRef = useRef(null);
  const mainRearCameraDeviceIdRef = useRef(null);

  // Call ringtone audio lifecycle
  useEffect(() => {
    if (callState === 'calling' || callState === 'ringing') {
      soundEngine.stopIncomingRingtone();
      soundEngine.startOutgoingRingTone();
    } else if (callState === 'incoming') {
      soundEngine.stopOutgoingRingTone();
      soundEngine.startIncomingRingtone();
    } else if (callState === 'connected') {
      soundEngine.stopOutgoingRingTone();
      soundEngine.stopIncomingRingtone();
      soundEngine.playCallConnected();
    } else if (callState === 'idle') {
      soundEngine.stopOutgoingRingTone();
      soundEngine.stopIncomingRingtone();
    }
  }, [callState]);

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

  const cleanupCall = useCallback((initiatedByRemote = false, reason = null) => {
    if (isCallInitiator.current && callPartyRef.current && onSendCallLog) {
      let status = 'completed';
      let duration = 0;

      if (callStateRef.current === 'connected') {
        if (callStartTime.current) {
          duration = Math.round((Date.now() - callStartTime.current) / 1000);
        }
      } else {
        if (reason === 'declined') {
          status = 'declined';
        } else {
          status = initiatedByRemote ? 'missed' : 'cancelled';
        }
      }

      onSendCallLog(callPartyRef.current, callMediaTypeRef.current, status, duration);
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.getSenders().forEach(s => {
          if (s.track) {
            try { s.track.stop(); } catch (e) {}
          }
        });
      } catch (e) {}
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      setLocalStream(null);
    }
    if (dummyTrackRef.current) {
      try { dummyTrackRef.current.stop(); } catch (e) {}
      dummyTrackRef.current = null;
    }
    if (originalVideoTrackRef.current) {
      try { originalVideoTrackRef.current.stop(); } catch (e) {}
      originalVideoTrackRef.current = null;
    }
    setRemoteStream(null);
    setCallState('idle');
    setCallParty('');
    pendingOfferRef.current = null;
    iceCandidatesQueue.current = [];
    callStartTime.current = null;
    isCallInitiator.current = false;
    
    soundEngine.stopOutgoingRingTone();
    soundEngine.stopIncomingRingtone();
    soundEngine.playCallEnded();
    
    setIsMuted(false);
    setIsCameraOff(false);
    setIsScreenSharing(false);
    setRemoteScreenSharing(false);
    setRemoteCameraOff(false);
    setRemoteMuted(false);
    setCameraFacingMode('user');
  }, [onSendCallLog, setCallParty, setCallState, setLocalStream]);

  const setupPeerConnection = useCallback((targetUser, stream) => {
    const pc = new RTCPeerConnection(pcConfig);
    peerConnectionRef.current = pc;

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const socket = getSocket();
        if (socket) {
          socket.emit('ice-candidate', {
            to: targetUser,
            candidate: event.candidate
          });
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        cleanupCall(true, 'Connection lost');
      }
    };

    return pc;
  }, [cleanupCall, pcConfig]);

  const handleInitiateCall = useCallback(async (media, targetUser = null) => {
    const target = targetUser || (activeContact ? activeContact.username : null);
    if (!target) return;

    if (callStateRef.current !== 'idle') {
      showToast?.('You are already in a call. Please hang up or decline the active call first.', 'warning', 'Active Call');
      return;
    }

    if (gcStateRef?.current && gcStateRef.current !== 'idle') {
      showToast?.('You are already in a group call.', 'warning', 'Active Call');
      return;
    }

    if (currentUser && target.toLowerCase() === currentUser.username.toLowerCase()) {
      showToast?.('You cannot place a call to yourself.', 'warning');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast?.('Calling is not supported by your current browser.', 'error', 'Unsupported Browser');
      return;
    }

    try {
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasAudio = devices.some(d => d.kind === 'audioinput');
        const hasVideo = devices.some(d => d.kind === 'videoinput');

        if (devices.length > 0 && !hasAudio) {
          showToast?.('No microphone found on this device. Please connect a microphone to place calls.', 'warning', 'Microphone Missing');
          return;
        }

        if (media === 'video' && devices.length > 0 && !hasVideo) {
          showToast?.('No camera found on this device. You can make a voice call instead.', 'warning', 'No Camera Found');
          return;
        }
      }
    } catch (e) {
      console.warn('Pre-flight enumerateDevices check skipped:', e);
    }

    let stream;
    try {
      if (media === 'video') {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(),
          video: getVideoConstraints()
        });
        dummyTrackRef.current = null;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(),
          video: false
        });
        const dummyTrack = createDummyVideoTrack();
        if (dummyTrack) {
          stream.addTrack(dummyTrack);
          dummyTrackRef.current = dummyTrack;
        }
      }
    } catch (err) {
      console.error('Call media pre-flight capture failed:', err);
      if (stream) {
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
      }

      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        if (media === 'video') {
          showToast?.('No camera found on this device. You can make a voice call instead.', 'warning', 'No Camera Found');
        } else {
          showToast?.('No microphone found on this device. Please connect a microphone to place calls.', 'warning', 'No Microphone Found');
        }
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showToast?.('Camera/Microphone permission was denied. Please allow access in your browser settings.', 'error', 'Permission Denied');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        showToast?.('Your camera or microphone is currently in use by another application.', 'error', 'Hardware In Use');
      } else {
        showToast?.(`Could not access media devices: ${err.message || 'Unknown device error'}`, 'error', 'Device Error');
      }
      return;
    }

    if (targetUser && onSelectContact) {
      const contacts = contactsRef?.current || [];
      const contactObj = contacts.find(c => c.username === target);
      if (contactObj) onSelectContact(contactObj);
    }
    
    isCallInitiator.current = true;
    setCallMediaType(media);
    setCallParty(target);
    setCallState('calling');
    setIsMuted(false);
    setIsCameraOff(media === 'voice');
    setIsScreenSharing(false);
    setRemoteScreenSharing(false);
    setRemoteCameraOff(media === 'voice');
    setLocalStream(stream);

    try {
      const pc = setupPeerConnection(target, stream);
      const offer = await pc.createOffer();
      offer.sdp = optimizeSDP(offer.sdp);
      await pc.setLocalDescription(offer);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && media === 'video') {
        if ('contentHint' in videoTrack) videoTrack.contentHint = 'motion';
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await optimizeSenderParameters(videoSender, false);
        }
      }

      const socket = getSocket();
      if (socket) {
        socket.emit('call-user', {
          to: target,
          offer,
          mediaType: media
        });
      }
    } catch (err) {
      console.error('Call offer setup failed:', err);
      showToast?.('Could not establish call connection.', 'error', 'Connection Error');
      cleanupCall();
    }
  }, [
    activeContact,
    cleanupCall,
    contactsRef,
    createDummyVideoTrack,
    currentUser,
    gcStateRef,
    getAudioConstraints,
    getVideoConstraints,
    onSelectContact,
    optimizeSDP,
    optimizeSenderParameters,
    setCallMediaType,
    setCallParty,
    setCallState,
    setLocalStream,
    setupPeerConnection,
    showToast
  ]);

  const handleAcceptCall = useCallback(async () => {
    if (!callPartyRef.current || !pendingOfferRef.current) return;

    let stream;
    let effectiveMediaType = callMediaTypeRef.current;
    try {
      if (callMediaTypeRef.current === 'video') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
            video: getVideoConstraints()
          });
          dummyTrackRef.current = null;
        } catch (videoErr) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: getAudioConstraints(),
            video: false
          });
          const dummyTrack = createDummyVideoTrack();
          if (dummyTrack) {
            stream.addTrack(dummyTrack);
            dummyTrackRef.current = dummyTrack;
          }
          effectiveMediaType = 'voice';
          showToast?.('No camera found on this device. Joined call as voice-only.', 'info', 'Voice Fallback');
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(),
          video: false
        });
        const dummyTrack = createDummyVideoTrack();
        if (dummyTrack) {
          stream.addTrack(dummyTrack);
          dummyTrackRef.current = dummyTrack;
        }
      }
    } catch (err) {
      console.error('Failed to acquire audio/video on accept:', err);
      showToast?.('Could not access microphone to accept call.', 'error', 'Permission Required');
      handleDeclineCall();
      return;
    }

    setCallState('connected');
    callStartTime.current = Date.now();
    setIsMuted(false);
    setIsCameraOff(effectiveMediaType === 'voice');
    setIsScreenSharing(false);
    setRemoteScreenSharing(false);
    setRemoteCameraOff(effectiveMediaType === 'voice');
    setLocalStream(stream);

    try {
      const pc = setupPeerConnection(callPartyRef.current, stream);
      await pc.setRemoteDescription({
        type: 'offer',
        sdp: optimizeSDP(pendingOfferRef.current.sdp)
      });

      const answer = await pc.createAnswer();
      answer.sdp = optimizeSDP(answer.sdp);
      await pc.setLocalDescription(answer);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && effectiveMediaType === 'video') {
        if ('contentHint' in videoTrack) videoTrack.contentHint = 'motion';
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await optimizeSenderParameters(videoSender, false);
        }
      }

      const socket = getSocket();
      if (socket) {
        socket.emit('make-answer', {
          to: callPartyRef.current,
          answer
        });
      }

      while (iceCandidatesQueue.current.length > 0) {
        const cand = iceCandidatesQueue.current.shift();
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      }
    } catch (err) {
      console.error('Failed to accept call:', err);
      showToast?.('Failed to connect call devices.', 'error', 'Call Error');
      handleDeclineCall();
    }
  }, [
    createDummyVideoTrack,
    getAudioConstraints,
    getVideoConstraints,
    optimizeSDP,
    optimizeSenderParameters,
    setCallState,
    setLocalStream,
    setupPeerConnection,
    showToast
  ]);

  const handleDeclineCall = useCallback(() => {
    const target = callPartyRef.current;
    const socket = getSocket();
    if (socket && target) {
      socket.emit('hang-up', { to: target, reason: 'declined' });
    }
    cleanupCall();
  }, [cleanupCall]);

  const handleHangUp = useCallback(() => {
    const target = callPartyRef.current;
    const socket = getSocket();
    if (socket && target) {
      socket.emit('hang-up', { to: target });
    }
    cleanupCall();
  }, [cleanupCall]);

  const handleToggleMute = useCallback(() => {
    setIsMuted(prev => {
      const nextMute = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(track => {
          track.enabled = !nextMute;
        });
      }

      const socket = getSocket();
      if (socket && callPartyRef.current) {
        socket.emit('call-media-update', { 
          to: callPartyRef.current, 
          mediaType: callMediaTypeRef.current, 
          screenSharing: isScreenSharing,
          cameraOff: isCameraOff,
          muted: nextMute
        });
      }

      return nextMute;
    });
  }, [isCameraOff, isScreenSharing]);

  const handleStopScreenShare = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    stream.getVideoTracks().forEach(track => {
      try { track.stop(); } catch (e) {}
      try { stream.removeTrack(track); } catch (e) {}
    });

    let restoredTrack = originalVideoTrackRef.current;
    originalVideoTrackRef.current = null;

    let cameraRestored = false;
    if (restoredTrack && restoredTrack.readyState === 'live') {
      cameraRestored = true;
    } else {
      if (restoredTrack) {
        try { restoredTrack.stop(); } catch (e) {}
      }
      restoredTrack = createDummyVideoTrack();
      dummyTrackRef.current = restoredTrack;
    }

    if (restoredTrack) {
      stream.addTrack(restoredTrack);
      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s && s.track && s.track.kind === 'video');
        if (videoSender) {
          try { await videoSender.replaceTrack(restoredTrack); } catch (e) {}
          if (cameraRestored) {
            await optimizeSenderParameters(videoSender, false);
          }
        }
      }
    }

    setIsScreenSharing(false);
    setIsCameraOff(!cameraRestored);
    setCallMediaType(cameraRestored ? 'video' : 'voice');
    setLocalStream(new MediaStream(stream.getTracks()));

    const socket = getSocket();
    if (socket && callPartyRef.current) {
      socket.emit('call-media-update', {
        to: callPartyRef.current,
        mediaType: cameraRestored ? 'video' : 'voice',
        screenSharing: false,
        cameraOff: !cameraRestored
      });
    }
  }, [createDummyVideoTrack, optimizeSenderParameters, setCallMediaType, setLocalStream]);

  const handleToggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;

    if (!isCameraOff) {
      const oldVideoTracks = stream.getVideoTracks();
      oldVideoTracks.forEach(track => {
        try { track.stop(); } catch (e) {}
        try { stream.removeTrack(track); } catch (e) {}
      });

      const dummyTrack = createDummyVideoTrack();
      if (dummyTrack) {
        dummyTrackRef.current = dummyTrack;
        stream.addTrack(dummyTrack);
        if (peerConnectionRef.current) {
          const senders = peerConnectionRef.current.getSenders();
          const videoSender = senders.find(s => s && s.track && s.track.kind === 'video');
          if (videoSender) {
            try { await videoSender.replaceTrack(dummyTrack); } catch (e) {}
          }
        }
      }

      setIsCameraOff(true);
      setLocalStream(new MediaStream(stream.getTracks()));
      
      if (isScreenSharing) {
        await handleStopScreenShare();
      }

      const socket = getSocket();
      if (socket && callPartyRef.current) {
        socket.emit('call-media-update', { 
          to: callPartyRef.current, 
          mediaType: callMediaTypeRef.current, 
          screenSharing: false,
          cameraOff: true
        });
      }
      return;
    }

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: getVideoConstraints()
      });
      const cameraTrack = camStream.getVideoTracks()[0];
      if (!cameraTrack) throw new Error('No camera track available.');

      if ('contentHint' in cameraTrack) {
        cameraTrack.contentHint = 'motion';
      }

      if (dummyTrackRef.current) {
        try { dummyTrackRef.current.stop(); } catch (e) {}
        try { stream.removeTrack(dummyTrackRef.current); } catch (e) {}
        dummyTrackRef.current = null;
      }

      stream.getVideoTracks().forEach(track => {
        if (track !== cameraTrack) {
          try { track.stop(); } catch (e) {}
          try { stream.removeTrack(track); } catch (e) {}
        }
      });

      stream.addTrack(cameraTrack);

      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s && s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(cameraTrack);
          await optimizeSenderParameters(videoSender, false);
        }
      }

      setCallMediaType('video');
      setIsCameraOff(false);
      setLocalStream(new MediaStream(stream.getTracks()));

      const socket = getSocket();
      if (socket && callPartyRef.current) {
        socket.emit('call-media-update', { 
          to: callPartyRef.current, 
          mediaType: 'video', 
          screenSharing: isScreenSharing,
          cameraOff: false
        });
      }
    } catch (err) {
      console.error("Failed to enable camera:", err);
      showToast?.("Could not access camera device.", "error", "Camera Error");
    }
  }, [
    createDummyVideoTrack,
    getVideoConstraints,
    handleStopScreenShare,
    isCameraOff,
    isScreenSharing,
    optimizeSenderParameters,
    setCallMediaType,
    setLocalStream,
    showToast
  ]);

  const handleSwitchCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream || isCameraOff) return;

    const oldVideoTracks = stream.getVideoTracks();

    try {
      const currentTrack = oldVideoTracks[0];
      const currentDeviceId = currentTrack?.getSettings?.().deviceId || cameraDeviceIdRef.current;

      let videoDevices = [];
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices = devices.filter(d => d.kind === 'videoinput');
      } catch (e) {
        console.warn('enumerateDevices failed:', e);
      }

      let nextDeviceId = null;
      let nextFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';

      if (videoDevices.length >= 2) {
        const frontDevice = videoDevices.find(d => /front|user|facetime|selfie/i.test(d.label));
        const backDevice = videoDevices.find(d => /back|rear|environment/i.test(d.label));

        if (cameraFacingMode === 'user') {
          if (mainRearCameraDeviceIdRef.current) {
            nextDeviceId = mainRearCameraDeviceIdRef.current;
          } else if (backDevice) {
            nextDeviceId = backDevice.deviceId;
          } else {
            const others = videoDevices.filter(d => d.deviceId !== currentDeviceId);
            if (others.length > 0) nextDeviceId = others[0].deviceId;
          }
          nextFacingMode = 'environment';
        } else {
          if (selfieCameraDeviceIdRef.current) {
            nextDeviceId = selfieCameraDeviceIdRef.current;
          } else if (frontDevice) {
            nextDeviceId = frontDevice.deviceId;
          } else {
            const others = videoDevices.filter(d => d.deviceId !== currentDeviceId);
            if (others.length > 0) nextDeviceId = others[0].deviceId;
          }
          nextFacingMode = 'user';
        }
      }

      let constraints;
      if (nextDeviceId) {
        constraints = {
          audio: false,
          video: {
            deviceId: { exact: nextDeviceId },
            ...getVideoConstraints()
          }
        };
      } else {
        constraints = {
          audio: false,
          video: {
            facingMode: { ideal: nextFacingMode },
            ...getVideoConstraints()
          }
        };
      }

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) throw new Error('Could not acquire new camera track.');

      if ('contentHint' in newTrack) newTrack.contentHint = 'motion';

      oldVideoTracks.forEach(t => {
        try { t.stop(); } catch (e) {}
        try { stream.removeTrack(t); } catch (e) {}
      });

      stream.addTrack(newTrack);

      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s && s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newTrack);
          await optimizeSenderParameters(videoSender, false);
        }
      }

      const activeId = newTrack.getSettings?.().deviceId || nextDeviceId;
      cameraDeviceIdRef.current = activeId;
      if (nextFacingMode === 'user') {
        selfieCameraDeviceIdRef.current = activeId;
      } else {
        mainRearCameraDeviceIdRef.current = activeId;
      }

      setCameraFacingMode(nextFacingMode);
      setLocalStream(new MediaStream(stream.getTracks()));
    } catch (err) {
      console.error('Camera switch failed:', err);
      showToast?.('Could not switch camera.', 'warning', 'Camera');
    }
  }, [cameraFacingMode, getVideoConstraints, isCameraOff, optimizeSenderParameters, setLocalStream, showToast]);

  const handleToggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      await handleStopScreenShare();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      showToast?.('Screen sharing is not supported by your browser.', 'error', 'Unsupported Feature');
      return;
    }

    try {
      let screenStream;
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: getScreenShareConstraints(),
          audio: false
        });
      } catch (err) {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        });
      }

      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error('No screen video track returned.');

      if ('contentHint' in screenTrack) screenTrack.contentHint = 'detail';

      screenTrack.onended = () => {
        handleStopScreenShare();
      };

      const stream = localStreamRef.current;
      if (!stream) throw new Error('No active local stream.');

      const oldVideoTracks = stream.getVideoTracks();
      const currentCameraTrack = oldVideoTracks.find(t => t !== dummyTrackRef.current);
      if (currentCameraTrack) {
        originalVideoTrackRef.current = currentCameraTrack;
        try { stream.removeTrack(currentCameraTrack); } catch (e) {}
      }

      if (dummyTrackRef.current) {
        try { dummyTrackRef.current.stop(); } catch (e) {}
        try { stream.removeTrack(dummyTrackRef.current); } catch (e) {}
        dummyTrackRef.current = null;
      }

      stream.addTrack(screenTrack);

      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s && s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
          await optimizeSenderParameters(videoSender, true);
        }
      }

      setIsScreenSharing(true);
      setCallMediaType('video');
      setIsCameraOff(false);
      setLocalStream(new MediaStream(stream.getTracks()));

      const socket = getSocket();
      if (socket && callPartyRef.current) {
        socket.emit('call-media-update', {
          to: callPartyRef.current,
          mediaType: 'video',
          screenSharing: true,
          cameraOff: false
        });
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.error('Failed to start screen share:', err);
        showToast?.('Could not share screen: ' + (err.message || 'Unknown error'), 'error', 'Screen Share Error');
      }
    }
  }, [
    getScreenShareConstraints,
    handleStopScreenShare,
    isScreenSharing,
    optimizeSenderParameters,
    setCallMediaType,
    setLocalStream,
    showToast
  ]);

  // Socket signaling listener attachments
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleCallMade = async ({ from, offer, mediaType }) => {
      console.log(`Received call offer from ${from} (${mediaType})`);
      if (callStateRef.current !== 'idle') {
        socket.emit('hang-up', { to: from });
        return;
      }
      if (gcStateRef?.current && gcStateRef.current !== 'idle') {
        socket.emit('hang-up', { to: from });
        return;
      }
      pendingOfferRef.current = offer;
      isCallInitiator.current = false;
      setCallMediaType(mediaType);
      setCallParty(from);
      setCallState('incoming');
    };

    const handleAnswerMade = async ({ answer, from }) => {
      console.log(`Received call answer from ${from}`);
      if (peerConnectionRef.current) {
        try {
          const answerDesc = answer?.sdp 
            ? new RTCSessionDescription(answer) 
            : new RTCSessionDescription({ type: 'answer', sdp: answer });
          await peerConnectionRef.current.setRemoteDescription(answerDesc);
          
          while (iceCandidatesQueue.current.length > 0) {
            const cand = iceCandidatesQueue.current.shift();
            try {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.error('Error adding queued ICE candidate:', e);
            }
          }

          callStartTime.current = Date.now();
          setCallState('connected');
        } catch (err) {
          console.error('Error setting remote description from answer:', err);
          cleanupCall(true, 'Connection failed');
        }
      }
    };

    const handleCallRinging = ({ from }) => {
      console.log(`Call is ringing on ${from}'s device`);
      setCallState('ringing');
    };

    const handleIceCandidateRelay = async ({ candidate, from }) => {
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        iceCandidatesQueue.current.push(candidate);
      }
    };

    const handleCallEnded = ({ from, reason }) => {
      console.log(`Call hung up by ${from}, reason: ${reason}`);
      if (reason === 'offline') {
        showToast?.(`${from} is currently offline.`, 'info', 'User Offline');
      } else if (reason === 'declined') {
        showToast?.(`${from} declined the call.`, 'info', 'Call Declined');
      } else if (reason === 'busy') {
        showToast?.(`${from} is on another call.`, 'info', 'User Busy');
      } else if (reason === 'user_unavailable') {
        showToast?.(`${from} is unavailable.`, 'info', 'User Unavailable');
      }
      cleanupCall(true, reason);
    };

    const handleCallMediaUpdated = ({ from, mediaType, screenSharing, cameraOff, muted }) => {
      setCallMediaType(mediaType);
      setRemoteScreenSharing(screenSharing);
      setRemoteCameraOff(!!cameraOff);
      setRemoteMuted(!!muted);
    };

    const handleCallError = ({ message }) => {
      showToast?.(message, 'warning', 'Call Alert');
      cleanupCall(true);
    };

    socket.on('call-made', handleCallMade);
    socket.on('answer-made', handleAnswerMade);
    socket.on('call-ringing', handleCallRinging);
    socket.on('ice-candidate-relay', handleIceCandidateRelay);
    socket.on('call-ended', handleCallEnded);
    socket.on('call-media-updated', handleCallMediaUpdated);
    socket.on('call-error', handleCallError);

    return () => {
      socket.off('call-made', handleCallMade);
      socket.off('answer-made', handleAnswerMade);
      socket.off('call-ringing', handleCallRinging);
      socket.off('ice-candidate-relay', handleIceCandidateRelay);
      socket.off('call-ended', handleCallEnded);
      socket.off('call-media-updated', handleCallMediaUpdated);
      socket.off('call-error', handleCallError);
    };
  }, [cleanupCall, gcStateRef, setCallMediaType, setCallParty, setCallState, showToast]);

  return {
    callState,
    setCallState,
    callStateRef,
    callMediaType,
    setCallMediaType,
    callMediaTypeRef,
    callParty,
    setCallParty,
    callPartyRef,
    localStream,
    setLocalStream,
    localStreamRef,
    remoteStream,
    isMuted,
    isCameraOff,
    isScreenSharing,
    remoteScreenSharing,
    remoteCameraOff,
    remoteMuted,
    cameraFacingMode,
    isCallMinimized,
    setIsCallMinimized,
    handleInitiateCall,
    handleAcceptCall,
    handleDeclineCall,
    handleHangUp,
    handleToggleMute,
    handleToggleCamera,
    handleSwitchCamera,
    handleToggleScreenShare,
    handleStopScreenShare,
    cleanupCall
  };
}

export default useWebRTC;
