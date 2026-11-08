// Local OCR fallback for the label text: tesseract word boxes on a clean crop, picking the text run under the click.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export interface OcrWord { text: string; left: number; top: number; width: number; height: number; conf: number }
export interface OcrAnswer { label: string; confidence: number; words: string[] }

let available: Promise<boolean> | null = null;
export const ocrAvailable = () => (available ??= run('tesseract', ['--version']).then(() => true, () => false));

export async function ocrWords(imagePath: string, psm = 11): Promise<OcrWord[]> {
  const { stdout } = await run('tesseract', [imagePath, '-', '--psm', String(psm), 'tsv'], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.split('\n').slice(1).map(line => line.split('\t')).filter(cols => cols.length >= 12 && cols[11].trim())
    .map(cols => ({ text: cols[11].trim(), left: Number(cols[6]), top: Number(cols[7]), width: Number(cols[8]), height: Number(cols[9]), conf: Number(cols[10]) }))
    .filter(word => word.conf >= 30 && /[\p{L}\p{N}]/u.test(word.text));
}

/** The text run on the click's row: words whose box overlaps the click's vertical band, joined across small gaps. */
export function labelNear(words: OcrWord[], x: number, y: number): OcrAnswer | null {
  const band = words.filter(word => y >= word.top - Math.max(6, word.height * 0.6) && y <= word.top + word.height + Math.max(6, word.height * 0.6)).sort((a, b) => a.left - b.left);
  if (!band.length) return null;
  const runs: OcrWord[][] = [];
  for (const word of band) {
    const current = runs.at(-1), last = current?.at(-1);
    // Words of one control sit close together; separate nav items or columns leave a gap of about a word height or more.
    if (last && word.left - (last.left + last.width) <= Math.max(8, Math.min(last.height, word.height) * 0.9) && Math.abs((word.top + word.height / 2) - (last.top + last.height / 2)) <= Math.max(last.height, word.height) * 0.6) current!.push(word);
    else runs.push([word]);
  }
  const distance = (words: OcrWord[]) => { const left = words[0].left, right = words.at(-1)!.left + words.at(-1)!.width; return x < left ? left - x : x > right ? x - right : 0; };
  const best = runs.map(items => ({ items, distance: distance(items) })).sort((a, b) => a.distance - b.distance)[0];
  if (best.distance > 40) return null;
  // The pointer sits on the clicked word, so an edge token read with low confidence is usually the cursor, not text.
  const items = [...best.items];
  while (items.length > 1 && items[0].conf < 55) items.shift();
  while (items.length > 1 && items.at(-1)!.conf < 55) items.pop();
  const text = items.map(word => word.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!text || !/[\p{L}\p{N}]{2}/u.test(text)) return null;
  return { label: text, confidence: Math.min(1, items.reduce((sum, word) => sum + word.conf, 0) / items.length / 100) * (best.distance ? 0.7 : 1), words: items.map(word => word.text) };
}

/** Second chance for small controls such as buttons: a tight single-line crop around the click, 3x, tesseract psm 7. */
export async function ocrLineAt(imagePath: string, x: number, y: number, outPath: string): Promise<OcrAnswer | null> {
  const w = 300, h = 60;
  await run('ffmpeg', ['-v', 'error', '-y', '-i', imagePath, '-vf', `crop=${w}:${h}:${Math.max(0, Math.round(x - w / 2))}:${Math.max(0, Math.round(y - h / 2))},scale=iw*3:ih*3:flags=lanczos`, outPath]);
  const words = (await ocrWords(outPath, 7)).filter(word => word.conf >= 50);
  if (!words.length) return null;
  return labelNear(words, Math.round(w / 2) * 3, Math.round(h / 2) * 3);
}
