// Two noise bands distinguish the pressure at the pilot's ears from the
// higher-frequency airflow around the lines. There is no motor on a speedwing.
export function createSound() {
  let context,
    master,
    windGain,
    edgeGain,
    windFilter,
    edgeFilter,
    active = true;
  try {
    active = localStorage.getItem("ridgeline.wind") !== "off";
  } catch {}
  function init() {
    if (context) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    const wind = context.createBuffer(
      2,
      context.sampleRate * 4,
      context.sampleRate,
    );
    for (let channel = 0; channel < 2; channel++) {
      const data = wind.getChannelData(channel);
      let previous = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        previous = 0.975 * previous + 0.145 * white;
        data[i] = previous * 0.75 + white * 0.2;
      }
    }
    const source = context.createBufferSource();
    source.buffer = wind;
    source.loop = true;
    windFilter = context.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.Q.value = 0.55;
    edgeFilter = context.createBiquadFilter();
    edgeFilter.type = "bandpass";
    edgeFilter.Q.value = 1.15;
    windGain = context.createGain();
    edgeGain = context.createGain();
    source.connect(windFilter).connect(windGain).connect(master);
    source.connect(edgeFilter).connect(edgeGain).connect(master);
    source.start();
  }
  async function resume() {
    if (active) {
      init();
      await context.resume();
    }
  }
  return {
    get enabled() {
      return active;
    },
    resume,
    async toggle() {
      active = !active;
      try {
        localStorage.setItem("ridgeline.wind", active ? "on" : "off");
      } catch {}
      await resume();
      if (!active && master)
        master.gain.setTargetAtTime(0, context.currentTime, 0.04);
      return active;
    },
    update(state, flying) {
      if (!context) return;
      const t = context.currentTime,
        speed = Math.min(1.6, state.speed / 29);
      const near = Math.exp(-Math.max(0, state.agl) / 12);
      master.gain.setTargetAtTime(active && flying ? 0.5 : 0, t, 0.12);
      windGain.gain.setTargetAtTime(0.04 + 0.58 * speed ** 2, t, 0.15);
      edgeGain.gain.setTargetAtTime(
        0.02 + speed ** 3 * 0.18 + near * 0.045,
        t,
        0.1,
      );
      windFilter.frequency.setTargetAtTime(210 + speed ** 2 * 760, t, 0.15);
      edgeFilter.frequency.setTargetAtTime(
        730 + speed * 820 + 100 * Math.min(2, Math.abs(state.bankRate || 0)),
        t,
        0.15,
      );
    },
    gate() {
      if (!context || !active) return;
      const osc = context.createOscillator(),
        env = context.createGain(),
        t = context.currentTime;
      osc.frequency.setValueAtTime(660, t);
      osc.frequency.exponentialRampToValueAtTime(990, t + 0.09);
      env.gain.setValueAtTime(0.055, t);
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
