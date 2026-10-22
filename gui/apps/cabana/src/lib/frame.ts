// Getting a picture of the arena from an image or a video.

export interface FrameSource {
  kind: 'image' | 'video' | 'blank';
  name: string;
  /** What is drawn in Experimental Setup. For a video it holds the current frame. */
  canvas: HTMLCanvasElement;
  /** Pixels of the original image or video per pixel of `canvas`, so tracked positions in pixels can be matched. */
  scale: number;
  video?: HTMLVideoElement;
  duration?: number;
}

const MAX_SIDE = 1280;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; k: number } {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  return { canvas, k };
}

export function blankFrame(width: number, height: number): FrameSource {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4f4f2';
  ctx.fillRect(0, 0, width, height);
  return { kind: 'blank', name: 'blank arena', canvas, scale: 1 };
}

async function loadImage(file: File): Promise<FrameSource> {
  const bmp = await createImageBitmap(file);
  const { canvas, k } = makeCanvas(bmp.width, bmp.height);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { kind: 'image', name: file.name, canvas, scale: 1 / k };
}

async function loadVideo(file: File): Promise<FrameSource> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () =>
      reject(
        new Error(
          "This browser can't read that video. Try an MP4 (H.264), or upload a still frame instead.",
        ),
      );
  });
  const { canvas, k } = makeCanvas(video.videoWidth, video.videoHeight);
  const f: FrameSource = {
    kind: 'video',
    name: file.name,
    canvas,
    scale: 1 / k,
    video,
    duration: video.duration,
  };
  await seekVideo(f, Math.min(1, video.duration / 2));
  return f;
}

export function loadFrameFile(file: File): Promise<FrameSource> {
  return file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(file.name)
    ? loadVideo(file)
    : loadImage(file);
}

/** Draw the video frame at time t (seconds) onto the frame's canvas. */
export function seekVideo(f: FrameSource, t: number): Promise<void> {
  const v = f.video!;
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => done(), 1500);
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      v.removeEventListener('seeked', done);
      f.canvas.getContext('2d')!.drawImage(v, 0, 0, f.canvas.width, f.canvas.height);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = Math.min(Math.max(t, 0), Math.max(v.duration - 0.05, 0));
  });
}

/**
 * The arena without the animal: each pixel is the median over frames spread across the video.
 * The animal moves, so it is not at the same pixel in most of them.
 */
export async function backgroundFrame(f: FrameSource, n = 15): Promise<void> {
  const k = Math.min(1, 640 / Math.max(f.canvas.width, f.canvas.height));
  const w = Math.round(f.canvas.width * k);
  const h = Math.round(f.canvas.height * k);
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const wctx = work.getContext('2d', { willReadFrequently: true })!;
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < n; i++) {
    await seekVideo(f, ((i + 0.5) / n) * f.duration!);
    wctx.drawImage(f.video!, 0, 0, w, h);
    frames.push(wctx.getImageData(0, 0, w, h).data);
  }
  const out = wctx.createImageData(w, h);
  const vals = new Uint8Array(n);
  for (let i = 0; i < out.data.length; i++) {
    if (i % 4 === 3) {
      out.data[i] = 255;
      continue;
    }
    for (let j = 0; j < n; j++) vals[j] = frames[j][i];
    out.data[i] = vals.sort()[n >> 1];
  }
  wctx.putImageData(out, 0, 0);
  f.canvas.getContext('2d')!.drawImage(work, 0, 0, f.canvas.width, f.canvas.height);
}
