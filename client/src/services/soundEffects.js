// Premium Acoustic Sound Effects Engine for Chatra
// Engineered using pure sine harmonics, exponential decay curves, and musical interval acoustics modeled after the Message Received chime.

class SoundEffectsEngine {
  constructor() {
    this.ctx = null;
    this.ringtoneInterval = null;
    this.dialingInterval = null;
  }

  getAudioContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  isSoundEnabled() {
    return localStorage.getItem('chatra_sound_effects') !== 'false';
  }

  isCategoryEnabled(key) {
    if (!this.isSoundEnabled()) return false;
    return localStorage.getItem(`chatra_sound_${key}`) !== 'false';
  }

  getVolume() {
    const vol = parseFloat(localStorage.getItem('chatra_sound_volume'));
    return isNaN(vol) ? 0.6 : Math.max(0, Math.min(1, vol));
  }

  createMasterNode(ctx, customVolumeScale = 1) {
    const master = ctx.createGain();
    const baseVolume = this.getVolume() * customVolumeScale;
    master.gain.setValueAtTime(baseVolume, ctx.currentTime);
    master.connect(ctx.destination);
    return master;
  }

  // 1. RELAXED ELEGANT MESSAGE SENT: Warm ascending chime (G5 -> C6) with 60ms spacing & 180ms decay
  playMessageSent() {
    if (!this.isCategoryEnabled('msg_sent')) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = this.createMasterNode(ctx, 0.3);

    // Note 1: G5 (783.99Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(783.99, now);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.5, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc1.connect(gain1);
    gain1.connect(master);
    osc1.start(now);
    osc1.stop(now + 0.14);

    // Note 2: C6 (1046.50Hz) - 60ms delay (relaxed, non-rushed spacing)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1046.50, now + 0.06);

    gain2.gain.setValueAtTime(0.01, now + 0.06);
    gain2.gain.linearRampToValueAtTime(0.6, now + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc2.connect(gain2);
    gain2.connect(master);
    osc2.start(now + 0.06);
    osc2.stop(now + 0.22);
  }

  // 2. MESSAGE RECEIVED: Elegant dual-tone chime (D5 -> A5) [KEPT AS THE GOLD STANDARD]
  playMessageReceived() {
    if (!this.isCategoryEnabled('msg_recv')) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = this.createMasterNode(ctx, 0.35);

    // Note 1: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);

    gain1.gain.setValueAtTime(0.01, now);
    gain1.gain.linearRampToValueAtTime(0.6, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc1.connect(gain1);
    gain1.connect(master);
    osc1.start(now);
    osc1.stop(now + 0.14);

    // Note 2: A5 (880.00 Hz) - 60ms delay
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.00, now + 0.06);

    gain2.gain.setValueAtTime(0.01, now + 0.06);
    gain2.gain.linearRampToValueAtTime(0.75, now + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc2.connect(gain2);
    gain2.connect(master);
    osc2.start(now + 0.06);
    osc2.stop(now + 0.24);
  }

  // 3. VOICE RECORD START: Crisp 2-note ascending fifth (C5 -> G5)
  playVoiceRecordStart() {
    if (!this.isCategoryEnabled('voice_rec')) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = this.createMasterNode(ctx, 0.3);

    const notes = [523.25, 783.99]; // C5 -> G5
    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.04;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.01, startTime);
      gain.gain.linearRampToValueAtTime(0.5, startTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.09);

      osc.connect(gain);
      gain.connect(master);
      osc.start(startTime);
      osc.stop(startTime + 0.1);
    });
  }

  // 4. VOICE RECORD STOP: Soft 2-note descending fifth (G5 -> C5)
  playVoiceRecordStop() {
    if (!this.isCategoryEnabled('voice_rec')) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = this.createMasterNode(ctx, 0.3);

    const notes = [783.99, 523.25]; // G5 -> C5
    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.04;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.01, startTime);
      gain.gain.linearRampToValueAtTime(0.5, startTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.09);

      osc.connect(gain);
      gain.connect(master);
      osc.start(startTime);
      osc.stop(startTime + 0.1);
    });
  }

  // 5. CALL CONNECTED: Rich 3-note ascending triad (C5 -> E5 -> G5)
  playCallConnected() {
    if (!this.isCategoryEnabled('call_connect')) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = this.createMasterNode(ctx, 0.4);

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.01, startTime);
      gain.gain.linearRampToValueAtTime(0.55, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.22);

      osc.connect(gain);
      gain.connect(master);
      osc.start(startTime);
      osc.stop(startTime + 0.24);
    });
  }

  // 6. CALL ENDED: Gentle 2-note descending chord (G5 -> C5)
  playCallEnded() {
    if (!this.isCategoryEnabled('call_connect')) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = this.createMasterNode(ctx, 0.4);

    const notes = [783.99, 523.25]; // G5, C5
    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.01, startTime);
      gain.gain.linearRampToValueAtTime(0.5, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

      osc.connect(gain);
      gain.connect(master);
      osc.start(startTime);
      osc.stop(startTime + 0.28);
    });
  }

  // 7. MUTE / CAMERA TOGGLE: Clean single-note chime
  playToggleMute(isMuted) {
    if (!this.isCategoryEnabled('toggle_clicks')) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = this.createMasterNode(ctx, 0.25);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    // Unmute (ON) = E5 (659.25Hz), Mute (OFF) = C5 (523.25Hz)
    const freq = isMuted ? 523.25 : 659.25;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  // 8. CONTACT ONLINE: Soft double-tone (E5 -> A5)
  playUserOnline() {
    if (!this.isCategoryEnabled('user_online')) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const master = this.createMasterNode(ctx, 0.2);

    const notes = [659.25, 880.00]; // E5, A5
    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.05;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.01, startTime);
      gain.gain.linearRampToValueAtTime(0.35, startTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      osc.connect(gain);
      gain.connect(master);
      osc.start(startTime);
      osc.stop(startTime + 0.14);
    });
  }

  // 9. OUTGOING CALL DIALING: Real Warm International Telephone Ringback Tone (WhatsApp / Signal style)
  startOutgoingRingTone() {
    if (this.dialingInterval) return;
    if (!this.isCategoryEnabled('call_dial')) return;

    const playWarmRingback = () => {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      
      // Warm low-pass filter to sound like a natural distant telephone line
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, now);

      const master = ctx.createGain();
      const baseVolume = this.getVolume() * 0.2; // Soft & non-intrusive
      master.gain.setValueAtTime(baseVolume, now);

      master.connect(filter);
      filter.connect(ctx.destination);

      // Traditional 440Hz + 480Hz ringback dual frequencies
      [440, 480].forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        // Smooth 50ms attack, 1.2s sustain, 200ms decay
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
        gain.gain.setValueAtTime(0.3, now + 1.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.35);

        osc.connect(gain);
        gain.connect(master);

        osc.start(now);
        osc.stop(now + 1.4);
      });
    };

    playWarmRingback();
    this.dialingInterval = setInterval(playWarmRingback, 3600);
  }

  stopOutgoingRingTone() {
    if (this.dialingInterval) {
      clearInterval(this.dialingInterval);
      this.dialingInterval = null;
    }
  }

  // 10. INCOMING CALL RINGTONE: Elegant 4-note chime sequence (A4 -> C#5 -> E5 -> A5)
  startIncomingRingtone() {
    if (this.ringtoneInterval) return;
    if (!this.isCategoryEnabled('call_ring')) return;

    const playChime = () => {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const master = this.createMasterNode(ctx, 0.35);

      const phrase = [440.00, 554.37, 659.25, 880.00]; // A4, C#5, E5, A5
      phrase.forEach((freq, idx) => {
        const startTime = now + idx * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.01, startTime);
        gain.gain.linearRampToValueAtTime(0.4, startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28);

        osc.connect(gain);
        gain.connect(master);
        osc.start(startTime);
        osc.stop(startTime + 0.3);
      });
    };

    playChime();
    this.ringtoneInterval = setInterval(playChime, 2400);
  }

  stopIncomingRingtone() {
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }
}

export const soundEngine = new SoundEffectsEngine();
