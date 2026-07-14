type BrowserWindowWithAudio = Window & {
  webkitAudioContext?: typeof AudioContext;
};

function tone(
  context: AudioContext,
  destination: AudioNode,
  frequency: number,
  start: number,
  duration: number,
  type: OscillatorType,
  volume: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function sparkle(context: AudioContext, destination: AudioNode, start: number, duration: number, volume: number) {
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(1800, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(start);
  source.stop(start + duration);
}

function sweepNoise(context: AudioContext, destination: AudioNode, start: number, duration: number, volume: number) {
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    const fadeIn = Math.min(1, index / (data.length * 0.18));
    const fadeOut = 1 - index / data.length;
    data[index] = (Math.random() * 2 - 1) * fadeIn * fadeOut;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(420, start);
  filter.frequency.exponentialRampToValueAtTime(2600, start + duration * 0.72);
  filter.Q.setValueAtTime(0.7, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.045);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(start);
  source.stop(start + duration);
}

export function playFlipSound() {
  if (typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext || (window as BrowserWindowWithAudio).webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const context = new AudioContextClass();
    if (context.state === "suspended") void context.resume();

    const now = context.currentTime;
    const master = context.createGain();
    master.connect(context.destination);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.52, now + 0.03);
    sweepNoise(context, master, now, 0.34, 0.065);
    tone(context, master, 392, now + 0.03, 0.22, "triangle", 0.025);
    tone(context, master, 523.25, now + 0.12, 0.24, "sine", 0.018);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    window.setTimeout(() => void context.close(), 580);
  } catch {
    // Browsers may block audio in unusual cases; flipping should still work.
  }
}

export function playAnswerSound(correct: boolean) {
  if (typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext || (window as BrowserWindowWithAudio).webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const context = new AudioContextClass();
    if (context.state === "suspended") void context.resume();

    const now = context.currentTime;
    const master = context.createGain();
    master.connect(context.destination);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(correct ? 0.78 : 0.58, now + 0.03);

    if (correct) {
      tone(context, master, 523.25, now, 0.36, "sine", 0.11);
      tone(context, master, 659.25, now + 0.1, 0.38, "sine", 0.1);
      tone(context, master, 783.99, now + 0.21, 0.44, "sine", 0.095);
      tone(context, master, 1046.5, now + 0.36, 0.42, "triangle", 0.055);
      sparkle(context, master, now + 0.16, 0.32, 0.018);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
      window.setTimeout(() => void context.close(), 1040);
    } else {
      tone(context, master, 329.63, now, 0.28, "triangle", 0.07);
      tone(context, master, 246.94, now + 0.13, 0.36, "sine", 0.075);
      tone(context, master, 196, now + 0.31, 0.42, "sine", 0.05);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);
      window.setTimeout(() => void context.close(), 920);
    }
  } catch {
    // Browsers may block audio in unusual cases; answer selection should still work.
  }
}
