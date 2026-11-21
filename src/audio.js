// Filtered wind follows the current airspeed. Audio starts after a user gesture.
export function createSound() {
  let context,
    gain,
    filter,
    active = false;
  function init() {
    if (context) return;
    context = new AudioContext();
    const buffer = context.createBuffer(
      1,
      context.sampleRate * 3,
      context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < samples.length; i++) {
      last = (last + 0.11 * (Math.random() * 2 - 1)) / 1.02;
      samples[i] = last;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    filter = context.createBiquadFilter();
    filter.type = "lowpass";
    gain = context.createGain();
    gain.gain.value = 0;
    noise.connect(filter).connect(gain).connect(context.destination);
    noise.start();
  }
  return {
    async toggle() {
      init();
      await context.resume();
      active = !active;
      return active;
    },
    update(speed, flying) {
      if (!context) return;
      gain.gain.setTargetAtTime(
        active && flying ? 0.12 + speed / 140 : 0,
        context.currentTime,
        0.15,
      );
      filter.frequency.setTargetAtTime(
        320 + speed * 28,
        context.currentTime,
        0.2,
      );
    },
    gate() {
      if (!context || !active) return;
      const osc = context.createOscillator(),
        env = context.createGain(),
        t = context.currentTime;
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.exponentialRampToValueAtTime(990, t + 0.09);
      env.gain.setValueAtTime(0.06, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(env).connect(context.destination);
      osc.start(t);
      osc.stop(t + 0.2);
      osc.onended = () => {
        osc.disconnect();
        env.disconnect();
      };
    },
  };
}
