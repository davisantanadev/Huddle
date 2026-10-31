// Plays the PCM chunks (48 kHz, stereo, 16-bit) from the system audio helper into
// a Web Audio graph, with a small buffer to absorb IPC jitter.
const CAPACITY = 48000;
const START_FRAMES = 1920; // 40 ms
const MAX_FRAMES = 14400; // 300 ms: beyond this, catch up instead of drifting behind

class EcoPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(CAPACITY);
    this.right = new Float32Array(CAPACITY);
    this.read = 0;
    this.write = 0;
    this.size = 0;
    this.playing = false;
    this.port.onmessage = (e) => this.push(new Int16Array(e.data));
  }

  push(pcm) {
    for (let i = 0; i + 1 < pcm.length; i += 2) {
      this.left[this.write] = pcm[i] / 32768;
      this.right[this.write] = pcm[i + 1] / 32768;
      this.write = (this.write + 1) % CAPACITY;
      if (this.size < CAPACITY) this.size++;
      else this.read = (this.read + 1) % CAPACITY;
    }
    if (this.size > MAX_FRAMES) {
      this.read = (this.read + this.size - START_FRAMES) % CAPACITY;
      this.size = START_FRAMES;
    }
  }

  process(_inputs, outputs) {
    const [l, r] = outputs[0];
    if (!this.playing && this.size >= START_FRAMES) this.playing = true;
    if (!this.playing) return true;
    for (let i = 0; i < l.length; i++) {
      if (this.size === 0) {
        this.playing = false;
        break;
      }
      l[i] = this.left[this.read];
      if (r) r[i] = this.right[this.read];
      this.read = (this.read + 1) % CAPACITY;
      this.size--;
    }
    return true;
  }
}

registerProcessor("eco-pcm", EcoPcmProcessor);
