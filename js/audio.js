/**
 * FOCUS//ECE — Procedural Web Audio API Ambient Sound Synthesizer
 * Generates Brown Noise, Rain, and Library tones directly in browser memory without external mp3 files.
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.currentMode = 'none'; // 'none' | 'brown' | 'rain' | 'library'
    this.activeNodes = [];
    this.masterGain = null;
    this.volume = 0.4;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  stop() {
    this.activeNodes.forEach(node => {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch (e) {
        // ignore already stopped
      }
    });
    this.activeNodes = [];
    this.currentMode = 'none';
  }

  playBrownNoise() {
    this.init();
    this.stop();
    this.currentMode = 'brown';

    // 5 seconds brown noise buffer looped
    const bufferSize = this.ctx.sampleRate * 5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Brown noise integration filter
      lastOut = (lastOut + (0.02 * white)) / 1.02;
      data[i] = lastOut * 3.5;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    // Gentle low-pass filter to keep it deep and non-fatiguing
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, this.ctx.currentTime);

    noise.connect(filter);
    filter.connect(this.masterGain);
    noise.start();

    this.activeNodes.push(noise, filter);
  }

  playRain() {
    this.init();
    this.stop();
    this.currentMode = 'rain';

    const bufferSize = this.ctx.sampleRate * 4;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    // Bandpass for rain patter
    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(1000, this.ctx.currentTime);
    bandpass.Q.setValueAtTime(0.6, this.ctx.currentTime);

    // High shelf to soften harsh highs
    const highShelf = this.ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.setValueAtTime(3000, this.ctx.currentTime);
    highShelf.gain.setValueAtTime(-8, this.ctx.currentTime);

    noise.connect(bandpass);
    bandpass.connect(highShelf);
    highShelf.connect(this.masterGain);
    noise.start();

    this.activeNodes.push(noise, bandpass, highShelf);
  }

  playLibrary() {
    this.init();
    this.stop();
    this.currentMode = 'library';

    // Warm, distant room tone resonance
    const bufferSize = this.ctx.sampleRate * 6;
    const buffer = this.ctx.createBuffer(2, bufferSize, this.ctx.sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    for (let i = 0; i < bufferSize; i++) {
      left[i] = (Math.random() * 2 - 1) * 0.15;
      right[i] = (Math.random() * 2 - 1) * 0.15;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(250, this.ctx.currentTime);

    const peaking = this.ctx.createBiquadFilter();
    peaking.type = 'peaking';
    peaking.frequency.setValueAtTime(120, this.ctx.currentTime);
    peaking.gain.setValueAtTime(6, this.ctx.currentTime);

    noise.connect(lowpass);
    lowpass.connect(peaking);
    peaking.connect(this.masterGain);
    noise.start();

    this.activeNodes.push(noise, lowpass, peaking);
  }

  playChime() {
    this.init();
    const now = this.ctx.currentTime;
    // Pleasant 3-note harmonic chime (C5, E5, G5)
    const freqs = [523.25, 659.25, 783.99];

    freqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);

      gain.gain.setValueAtTime(0, now + idx * 0.1);
      gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 1.8);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 2.0);
    });
  }
}

export const soundEngine = new SoundEngine();
