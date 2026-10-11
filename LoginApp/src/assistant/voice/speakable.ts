/**
 * Make text sound right when read by a speech engine: no markdown, no emoji,
 * units spelled out, rupee amounts and percentages spoken the way a person says them.
 */

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
const DEVANAGARI = /[ऀ-ॿ]/;

export const hasDevanagari = (text: string): boolean => DEVANAGARI.test(text);

export function speakable(text: string): string {
  let t = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(EMOJI, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/https?:\/\/\S+/g, 'a link');
  // ₹1,200 -> 1,200 rupees; ₹18/kWh -> 18 rupees per kilowatt hour
  t = t
    .replace(
      /₹\s?(\d[\d,]*(?:\.\d+)?)\s?\/\s?kWh/gi,
      '$1 rupees per kilowatt hour',
    )
    .replace(/₹\s?(\d[\d,]*(?:\.\d+)?)/g, '$1 rupees')
    .replace(/\bRs\.?\s?(\d[\d,]*(?:\.\d+)?)/g, '$1 rupees');
  if (!hasDevanagari(t)) {
    t = t
      .replace(/(\d)\s?%/g, '$1 percent')
      .replace(/\bkWh\b/g, 'kilowatt hour')
      .replace(/\bkW\b/g, 'kilowatt')
      .replace(/\bkm\/h\b/gi, 'kilometres per hour')
      .replace(/(\d)\s?km\b/gi, '$1 kilometres')
      .replace(/\bCCS2\b/g, 'C C S 2')
      .replace(/\bCHAdeMO\b/gi, 'Chademo')
      .replace(/\bDC\b/g, 'D C')
      .replace(/\bAC\b/g, 'A C')
      .replace(/\bEV\b/g, 'E V')
      .replace(/\bETA\b/g, 'E T A');
  }
  return t.replace(/\s{2,}/g, ' ').trim();
}

/** The voice to use for a piece of text: Hindi voice for Devanagari, Indian English otherwise. */
export function localeFor(text: string): 'hi-IN' | 'en-IN' {
  return hasDevanagari(text) ? 'hi-IN' : 'en-IN';
}
