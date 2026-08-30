import { useState, useEffect } from 'react';

export const defaultIceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelay',
    credential: 'openrelay'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelay',
    credential: 'openrelay'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelay',
    credential: 'openrelay'
  }
];

export function useIceServers() {
  const [dynamicIceServers, setDynamicIceServers] = useState(defaultIceServers);

  useEffect(() => {
    fetch('/api/webrtc/ice-servers')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          setDynamicIceServers(data.iceServers);
        }
      })
      .catch(() => {
        // Fallback to default STUN/TURN list
      });
  }, []);

  return { iceServers: dynamicIceServers };
}
