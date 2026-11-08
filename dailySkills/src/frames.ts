// Frames for labeling: PSAI tasks ship a screen video, so the frame at a click's time can be cut with ffmpeg.
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile);

export interface Image { mediaType: 'image/jpeg'; base64: string }
export interface VideoInfo { path: string; width: number; height: number; durationS: number }

const PSAI_VIDEO = (id: string) => `https://huggingface.co/datasets/anaisleila/computer-use-data-psai/resolve/main/videos/${id}.mp4`;

export async function ensurePsaiVideo(id: string, cacheDir: string): Promise<VideoInfo> {
  if (!/^[a-z0-9]+$/i.test(id)) throw new Error(`unsafe task id ${id}`);
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, `${id}.mp4`);
  if (!(await stat(path).catch(() => null))?.size) {
    const response = await fetch(PSAI_VIDEO(id), { redirect: 'follow', signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`video download HTTP ${response.status} for ${id}`);
    await writeFile(path, new Uint8Array(await response.arrayBuffer()));
  }
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path]);
  const probe = JSON.parse(stdout) as { streams: { width: number; height: number }[]; format: { duration: string } };
  return { path, width: probe.streams[0].width, height: probe.streams[0].height, durationS: Number(probe.format.duration) };
}

/** Two JPEGs: the full frame (scaled to 1280 wide) with a red box at the click, and a 480x320 crop around it. */
export interface ClickFrames { full: Image; crop: Image; files: string[]; ocr: { path: string; x: number; y: number } }
export async function clickFrames(video: VideoInfo, seconds: number, x: number, y: number, outDir: string, name: string): Promise<ClickFrames> {
  await mkdir(outDir, { recursive: true });
  const t = Math.min(Math.max(0, seconds), Math.max(0, video.durationS - 0.05)).toFixed(3);
  const X = Math.round(x), Y = Math.round(y);
  const fullPath = join(outDir, `${name}-full.jpg`), cropPath = join(outDir, `${name}-crop.jpg`);
  const cw = Math.min(480, video.width), ch = Math.min(320, video.height);
  const cx = Math.min(Math.max(0, X - cw / 2), video.width - cw), cy = Math.min(Math.max(0, Y - ch / 2), video.height - ch);
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', t, '-i', video.path, '-frames:v', '1', '-vf', `drawbox=x=${X - 30}:y=${Y - 30}:w=60:h=60:color=red@0.9:t=5,scale=1280:-2`, '-q:v', '3', fullPath]);
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', t, '-i', video.path, '-frames:v', '1', '-vf', `crop=${cw}:${ch}:${Math.round(cx)}:${Math.round(cy)},drawbox=x=${Math.round(X - cx) - 22}:y=${Math.round(Y - cy) - 22}:w=44:h=44:color=red@0.9:t=4`, '-q:v', '3', cropPath]);
  // Clean crop (no marker, 2x) for OCR: the marker would cover the very text we want to read.
  const ocrPath = join(outDir, `${name}-ocr.png`);
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', t, '-i', video.path, '-frames:v', '1', '-vf', `crop=${cw}:${ch}:${Math.round(cx)}:${Math.round(cy)},scale=${cw * 2}:${ch * 2}:flags=lanczos`, ocrPath]);
  const [full, crop] = await Promise.all([readFile(fullPath), readFile(cropPath)]);
  return { full: { mediaType: 'image/jpeg', base64: full.toString('base64') }, crop: { mediaType: 'image/jpeg', base64: crop.toString('base64') }, files: [fullPath, cropPath, ocrPath], ocr: { path: ocrPath, x: Math.round(X - cx) * 2, y: Math.round(Y - cy) * 2 } };
}
