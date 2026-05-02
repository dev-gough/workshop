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

// Per-step undo record. We keep one of these for every step() call so the
// animator can support manual stepBack() while paused.
interface UndoEntry {
  ip: number;
  dataPtr: number;
  calcs: number;
  outputLen: number;
  // The single cell modified by this step, if any. -1 means no cell write.
  cellIdx: number;
  cellOld: number;
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
  private history: UndoEntry[] = [];
  private readonly historyCap = 200_000;

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
    this.history.length = 0;
  }

  // Execute one BF instruction. Returns false when the program halts (done or truncated).
  step(): boolean {
    if (this.done || this.truncated) return false;
    if (this.ip >= this.source.length) {
      this.done = true;
      return false;
    }

    // Snapshot pre-mutation state so stepBack() can undo this instruction.
    const undo: UndoEntry = {
      ip: this.ip,
      dataPtr: this.dataPtr,
      calcs: this.calcs,
      outputLen: this.output.length,
      cellIdx: -1,
      cellOld: 0,
    };

    const ch = this.source[this.ip];
    this.lastWritten = -1;
    let truncatedHere = false;

    switch (ch) {
      case '>': {
        this.calcs++;
        if (this.bumpCalc()) { truncatedHere = true; break; }
        this.dataPtr = this.dataPtr === MEMORY_SIZE - 1 ? 0 : this.dataPtr + 1;
        break;
      }
      case '<': {
        this.calcs++;
        if (this.bumpCalc()) { truncatedHere = true; break; }
        this.dataPtr = this.dataPtr === 0 ? MEMORY_SIZE - 1 : this.dataPtr - 1;
        break;
      }
      case '+': {
        undo.cellIdx = this.dataPtr;
        undo.cellOld = this.memory[this.dataPtr];
        this.memory[this.dataPtr]++;
        this.lastWritten = this.dataPtr;
        this.calcs++;
        if (this.bumpCalc()) { truncatedHere = true; break; }
        break;
      }
      case '-': {
        undo.cellIdx = this.dataPtr;
        undo.cellOld = this.memory[this.dataPtr];
        let v = this.memory[this.dataPtr] - 1;
        if (v < 0) v = 127;
        this.memory[this.dataPtr] = v;
        this.lastWritten = this.dataPtr;
        this.calcs++;
        if (this.bumpCalc()) { truncatedHere = true; break; }
        break;
      }
      case '.': {
        // Treat the byte as Latin-1 for display. Negative bytes become high
        // code points just like Java's (char)(byte)x — fine for visualization.
        const cp = this.memory[this.dataPtr] & 0xff;
        this.output += String.fromCharCode(cp);
        this.calcs++;
        if (this.bumpCalc()) { truncatedHere = true; break; }
        break;
      }
      case ',': {
        this.calcs++;
        if (this.bumpCalc()) { truncatedHere = true; break; }
        break;
      }
      case '[': {
        this.calcs++;
        if (this.bumpCalc()) { truncatedHere = true; break; }
        if (this.memory[this.dataPtr] === 0) {
          // Scan forward to the matching ']', counting calcs per char (Java parity).
          let i = this.ip + 1;
          let depth = 0;
          while (i < this.source.length && (depth > 0 || this.source[i] !== ']')) {
            this.calcs++;
            if (this.bumpCalc()) { truncatedHere = true; break; }
            const c = this.source[i];
            if (c === '[') depth++;
            else if (c === ']') depth--;
            i++;
          }
          if (truncatedHere) break;
          if (i >= this.source.length) {
            this.truncated = true;
            this.pushHistory(undo);
            return false;
          }
          this.ip = i;
        }
        break;
      }
      case ']': {
        this.calcs++;
        if (this.bumpCalc()) { truncatedHere = true; break; }
        if (this.memory[this.dataPtr] !== 0) {
          let i = this.ip - 1;
          let depth = 0;
          while (i >= 0 && (depth > 0 || this.source[i] !== '[')) {
            this.calcs++;
            if (this.bumpCalc()) { truncatedHere = true; break; }
            const c = this.source[i];
            if (c === ']') depth++;
            else if (c === '[') depth--;
            i--;
          }
          if (truncatedHere) break;
          if (i < 0) {
            this.truncated = true;
            this.pushHistory(undo);
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

    this.pushHistory(undo);

    if (truncatedHere) return false;

    this.ip++;
    if (this.ip >= this.source.length) this.done = true;
    return !this.done;
  }

  // Undo the most recent step. Returns false if there's nothing to undo.
  stepBack(): boolean {
    const e = this.history.pop();
    if (!e) return false;
    this.ip = e.ip;
    this.dataPtr = e.dataPtr;
    this.calcs = e.calcs;
    if (this.output.length > e.outputLen) this.output = this.output.slice(0, e.outputLen);
    if (e.cellIdx >= 0) this.memory[e.cellIdx] = e.cellOld;
    this.done = false;
    this.truncated = false;
    this.lastWritten = -1;
    return true;
  }

  private pushHistory(entry: UndoEntry): void {
    this.history.push(entry);
    if (this.history.length > this.historyCap) {
      // Drop the oldest 25% to amortize the shift cost.
      this.history.splice(0, Math.floor(this.historyCap / 4));
    }
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
