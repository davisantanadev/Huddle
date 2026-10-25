// ==========================================================================
// Noise suppression (RNNoise, a small neural network that keeps the voice and
// removes keyboard, fan, traffic, TV...). Chromium's own "noiseSuppression"
// constraint only takes out steady hiss, which is why it seemed not to work.
//
// Used on both ends: on our microphone before it is sent, and on what we
// receive from each person, so noise is cut even when the other side runs an
// older version without it.
// ==========================================================================
import { RnnoiseWorkletNode, loadRnnoise } from "../../node_modules/@sapphi-red/web-noise-suppressor/dist/index.js";

const BASE = new URL("../../node_modules/@sapphi-red/web-noise-suppressor/dist/", import.meta.url);

// RNNoise also lowers the voice a little (~6 dB measured): give part of it
// back, with a limiter so loud voices never clip
const MAKEUP_GAIN = 1.6;

let ctx = null;
let ready = null;

// One 48 kHz context (what RNNoise expects) shared by every filter
function setup() {
  if (!ready) {
    ready = (async () => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctx({ sampleRate: 48000, latencyHint: "interactive" });
      const [wasmBinary] = await Promise.all([
        loadRnnoise({ url: new URL("rnnoise.wasm", BASE).href, simdUrl: new URL("rnnoise_simd.wasm", BASE).href }),
        ctx.audioWorklet.addModule(new URL("rnnoise/workletProcessor.js", BASE).href)
      ]);
      return wasmBinary;
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

// Returns { stream, dispose } with the filtered audio of `stream`'s first audio track
export async function createDenoisedStream(stream) {
  const wasmBinary = await setup();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
  const gain = ctx.createGain();
  gain.gain.value = MAKEUP_GAIN;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.1;
  const out = ctx.createMediaStreamDestination();
  out.channelCount = 1;
  source.connect(node);
  node.connect(gain);
  gain.connect(limiter);
  limiter.connect(out);
  let disposed = false;
  return {
    stream: out.stream,
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        source.disconnect();
        node.disconnect();
        gain.disconnect();
        limiter.disconnect();
        node.destroy();
      } catch (_) {}
      out.stream.getTracks().forEach((t) => t.stop());
    }
  };
}

// Warm up (loads the model) so the first call does not start unfiltered
export function preloadNoiseSuppression() {
  return setup().then(
    () => true,
    () => false
  );
}
