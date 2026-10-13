/**
 * Splits streamed text into sentences as it arrives, so the first one can be
 * spoken while the model is still writing the rest.
 */

const END = /([.!?।]+["')\]]*)(\s+|$)/;
const MIN_FIRST = 8; // don't speak "Sure." as its own tiny utterance twice in a row
const MAX_CLAUSE = 150; // a very long sentence is cut at a comma so speech starts earlier

export class SentenceSplitter {
  private buffer = '';

  /** Add text; returns the sentences that are now complete. */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut < 0) {
        break;
      }
      const sentence = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (sentence) {
        out.push(sentence);
      }
    }
    return out;
  }

  /** The text has finished: whatever is left is the last sentence. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest ? [rest] : [];
  }

  reset(): void {
    this.buffer = '';
  }

  private findCut(): number {
    let from = 0;
    for (;;) {
      const m = END.exec(this.buffer.slice(from));
      if (!m) {
        break;
      }
      const end = from + m.index + m[1].length;
      const next = this.buffer.slice(end).trimStart();
      const before = this.buffer.slice(0, from + m.index);
      // "12.5", "e.g." and "No." are not sentence ends. A digit before and after a dot is a decimal.
      const decimal = /\d$/.test(before) && /^\d/.test(this.buffer.slice(end));
      const abbreviation = /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Dr|No)$/i.test(before);
      const waiting = m[2] === '' && next === ''; // the text so far ends exactly at a dot; more may follow
      if (
        !decimal &&
        !abbreviation &&
        !waiting &&
        before.trim().length >= MIN_FIRST
      ) {
        return end;
      }
      from = end;
    }
    if (this.buffer.length > MAX_CLAUSE) {
      const comma = this.buffer.lastIndexOf(', ', MAX_CLAUSE);
      if (comma > 40) {
        return comma + 1;
      }
    }
    return -1;
  }
}
