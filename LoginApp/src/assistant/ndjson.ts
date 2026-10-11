/**
 * Incremental parser for the gateway's newline-delimited JSON. Network chunks
 * arrive split anywhere, including in the middle of a multi-byte character's
 * line, so only complete lines are parsed and the remainder waits for more.
 */
export class NdjsonParser {
  private buffer = '';

  /** Feed the whole response text so far, or just a new chunk (`append`). */
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const out: unknown[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        try {
          out.push(JSON.parse(line));
        } catch {
          // A garbled line must not stop the stream; the next one is independent.
        }
      }
      newline = this.buffer.indexOf('\n');
    }
    return out;
  }

  /** The stream ended: whatever is left is a last line without its newline. */
  flush(): unknown[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (!rest) {
      return [];
    }
    try {
      return [JSON.parse(rest)];
    } catch {
      return [];
    }
  }
}
