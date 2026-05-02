// Mirror of the Java reference interpreter at brainfuck-genetic/Java/BrainFuck.java
// so what the animator shows matches what the GA's fitness function actually saw.
//
// Quirky semantics worth flagging:
//   • Cells are signed bytes (Int8Array). `+` overflows 127 → -128 normally.
//   • `-` clamps to 127 instead of wrapping (the Java does this too — it's a bug
//     in the upstream interpreter, but we have to match it for fidelity).
//   • `,` is a no-op — the GA can't supply input.
//   • Loop scan in `[` / `]` costs one calc per character scanned, matching Java.

export const MEMORY_SIZE = 65535;
export const DEFAULT_CALC_CAP = 250_000;

export interface BFSnapshot {
  ip: number;
  dataPtr: number;
  output: string;
  calcs: number;
  done: boolean;
  truncated: boolean;
  lastWritten: number;
}

export class BFInterpreter {
  readonly source: string;
  readonly memory: Int8Array;
  readonly calcCap: number;
  ip = 0;
  dataPtr = 0;
  output = '';
  calcs = 0;
  done = false;
  truncated = false;
  lastWritten = -1;

  constructor(source: string, calcCap: number = DEFAULT_CALC_CAP) {
    this.source = source;
    this.memory = new Int8Array(MEMORY_SIZE);
    this.calcCap = calcCap;
  }

  reset(): void {
    this.memory.fill(0);
    this.ip = 0;
    this.dataPtr = 0;
    this.output = '';
    this.calcs = 0;
    this.done = false;
    this.truncated = false;
    this.lastWritten = -1;
  }

  // Execute one BF instruction. Returns false when the program halts (done or truncated).
  step(): boolean {
    if (this.done || this.truncated) return false;
    if (this.ip >= this.source.length) {
      this.done = true;
      return false;
    }
    const ch = this.source[this.ip];
    this.lastWritten = -1;

    switch (ch) {
      case '>': {
        this.calcs++;
        if (this.bumpCalc()) return false;
        this.dataPtr = this.dataPtr === MEMORY_SIZE - 1 ? 0 : this.dataPtr + 1;
        break;
      }
      case '<': {
        this.calcs++;
        if (this.bumpCalc()) return false;
        this.dataPtr = this.dataPtr === 0 ? MEMORY_SIZE - 1 : this.dataPtr - 1;
        break;
      }
      case '+': {
        this.memory[this.dataPtr]++;
        this.lastWritten = this.dataPtr;
        this.calcs++;
        if (this.bumpCalc()) return false;
        break;
      }
      case '-': {
        let v = this.memory[this.dataPtr] - 1;
        if (v < 0) v = 127;
        this.memory[this.dataPtr] = v;
        this.lastWritten = this.dataPtr;
        this.calcs++;
        if (this.bumpCalc()) return false;
        break;
      }
      case '.': {
        // Treat the byte as Latin-1 for display. Negative bytes become high
        // code points just like Java's (char)(byte)x — fine for visualization.
        const cp = this.memory[this.dataPtr] & 0xff;
        this.output += String.fromCharCode(cp);
        this.calcs++;
        if (this.bumpCalc()) return false;
        break;
      }
      case ',': {
        this.calcs++;
        if (this.bumpCalc()) return false;
        break;
      }
      case '[': {
        this.calcs++;
        if (this.bumpCalc()) return false;
        if (this.memory[this.dataPtr] === 0) {
          // Scan forward to the matching ']', counting calcs per char (Java parity).
          let i = this.ip + 1;
          let depth = 0;
          while (i < this.source.length && (depth > 0 || this.source[i] !== ']')) {
            this.calcs++;
            if (this.bumpCalc()) return false;
            const c = this.source[i];
            if (c === '[') depth++;
            else if (c === ']') depth--;
            i++;
          }
          if (i >= this.source.length) {
            this.truncated = true;
            return false;
          }
          this.ip = i;
        }
        break;
      }
      case ']': {
        this.calcs++;
        if (this.bumpCalc()) return false;
        if (this.memory[this.dataPtr] !== 0) {
          let i = this.ip - 1;
          let depth = 0;
          while (i >= 0 && (depth > 0 || this.source[i] !== '[')) {
            this.calcs++;
            if (this.bumpCalc()) return false;
            const c = this.source[i];
            if (c === ']') depth++;
            else if (c === '[') depth--;
            i--;
          }
          if (i < 0) {
            this.truncated = true;
            return false;
          }
          this.ip = i;
        }
        break;
      }
      default:
        // Non-BF char — skip silently (the gene alphabet is fixed but be safe).
        break;
    }

    this.ip++;
    if (this.ip >= this.source.length) this.done = true;
    return !this.done;
  }

  private bumpCalc(): boolean {
    if (this.calcs >= this.calcCap) {
      this.truncated = true;
      this.output += '-1';
      return true;
    }
    return false;
  }

  snapshot(): BFSnapshot {
    return {
      ip: this.ip,
      dataPtr: this.dataPtr,
      output: this.output,
      calcs: this.calcs,
      done: this.done,
      truncated: this.truncated,
      lastWritten: this.lastWritten,
    };
  }

  runToCompletion(maxSteps = Infinity): void {
    let n = 0;
    while (this.step() && n < maxSteps) n++;
  }
}

// Pre-compute per-instruction execution counts for heatmap rendering.
// Runs a fresh interpretation; safe to call independently of any animator.
export function executionCounts(source: string, calcCap: number = DEFAULT_CALC_CAP): Int32Array {
  const counts = new Int32Array(source.length);
  const interp = new BFInterpreter(source, calcCap);
  while (!interp.done && !interp.truncated) {
    if (interp.ip < source.length) counts[interp.ip]++;
    if (!interp.step()) break;
  }
  return counts;
}
