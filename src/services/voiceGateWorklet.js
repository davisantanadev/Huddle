// Voice gate ("sensibilidade de entrada" automática). Noise filters keep
// anything that sounds like a voice: a TV, music or people talking in the room
// pass right through. Those are quieter than the person speaking into the mic,
// so this lets sound through only while the level is close to that person's
// own voice level, which it keeps learning (it adapts to each mic and room).
const FRAME = 480; // 10 ms at 48 kHz
const MIN_OPEN_DB = -60; // never opens on near silence
const HOLD_FRAMES = 25; // stays open 250 ms after the voice stops (word endings, breaths)
const CLOSED_GAIN = 0.03; // about -30 dB: quiet, but not an unnatural dead silence
const LOOKAHEAD = 480; // 10 ms delay so the first syllable is not cut

class VoiceGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // Sound more than this below the speaker's voice is treated as background
    this.belowVoiceDb = options?.processorOptions?.belowVoiceDb ?? 12;
    this.voiceDb = -30; // loud-frame level of whoever speaks into the mic
    this.hold = 0;
    this.gain = CLOSED_GAIN;
    this.target = CLOSED_GAIN;
    this.acc = 0;
    this.count = 0;
    this.delay = new Float32Array(LOOKAHEAD);
    this.pos = 0;
    this.enabled = true;
    this.port.onmessage = (e) => {
      if (typeof e.data?.enabled === "boolean") this.enabled = e.data.enabled;
    };
  }

  frameDone(db) {
    // Voice level: jumps up to loud frames, sinks ~1.5 dB/s otherwise, so it
    // follows the speaker (and a quieter mic) without dropping between words
    if (db > this.voiceDb) this.voiceDb += (db - this.voiceDb) * 0.3;
    else this.voiceDb -= 0.015;
    this.voiceDb = Math.max(this.voiceDb, MIN_OPEN_DB + this.belowVoiceDb);
    const open = db > Math.max(this.voiceDb - this.belowVoiceDb, MIN_OPEN_DB);
    if (open) this.hold = HOLD_FRAMES;
    else if (this.hold > 0) this.hold--;
    this.target = this.hold > 0 ? 1 : CLOSED_GAIN;
  }

  process(inputs, outputs) {
    const input = inputs[0][0];
    const output = outputs[0][0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      this.acc += x * x;
      if (++this.count === FRAME) {
        this.frameDone(10 * Math.log10(this.acc / FRAME + 1e-12));
        this.acc = 0;
        this.count = 0;
      }
      // Opens in ~3 ms, closes in ~60 ms
      const rate = this.target > this.gain ? 0.07 : 0.0004;
      this.gain += (this.target - this.gain) * rate;
      const delayed = this.delay[this.pos];
      this.delay[this.pos] = x;
      this.pos = (this.pos + 1) % LOOKAHEAD;
      output[i] = this.enabled ? delayed * this.gain : delayed;
    }
    return true;
  }
}

registerProcessor("eco-voice-gate", VoiceGateProcessor);
