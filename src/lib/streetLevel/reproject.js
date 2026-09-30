/**
 * Equirectangular → perspective re-projection for panorama captures.
 * `renderPerspective` is pure (RGBA arrays); `reprojectPanoramaBlob` wraps it
 * with browser canvas decoding/encoding.
 *
 * Assumes the panorama's horizontal center faces `panoCompass` (degrees from north),
 * which is how Mapillary exposes `computed_compass_angle` for spherical images.
 */

const toRad = (d) => (d * Math.PI) / 180;

function sampleBilinear(src, sw, sh, u, v, out, o) {
  const x = ((u % sw) + sw) % sw;
  const y = Math.max(0, Math.min(sh - 1, v));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % sw;
  const y1 = Math.min(sh - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 4; c += 1) {
    const a = src[(y0 * sw + x0) * 4 + c];
    const b = src[(y0 * sw + x1) * 4 + c];
    const d = src[(y1 * sw + x0) * 4 + c];
    const e = src[(y1 * sw + x1) * 4 + c];
    out[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
}

/**
 * @param {{ data: Uint8ClampedArray|number[], width: number, height: number }} src equirectangular RGBA
 * @param {{ heading: number, pitch?: number, fov?: number, width: number, height: number, panoCompass?: number }} view
 * @returns {Uint8ClampedArray} RGBA of size width×height
 */
export function renderPerspective(src, view) {
  const { width: w, height: h } = view;
  const out = new Uint8ClampedArray(w * h * 4);
  const hfov = toRad(Math.max(1, Math.min(179, view.fov ?? 90)));
  const f = (w / 2) / Math.tan(hfov / 2);
  const pitch = toRad(view.pitch ?? 0);
  const yaw = toRad((view.heading ?? 0) - (view.panoCompass ?? 0));
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const sw = src.width;
  const sh = src.height;
  for (let y = 0; y < h; y += 1) {
    const dy = h / 2 - y - 0.5;
    for (let x = 0; x < w; x += 1) {
      const dx = x - w / 2 + 0.5;
      const yy = dy * cp + f * sp;
      const zz = -dy * sp + f * cp;
      const lon = Math.atan2(dx, zz) + yaw;
      const lat = Math.atan2(yy, Math.hypot(dx, zz));
      const u = (lon / (2 * Math.PI) + 0.5) * sw - 0.5;
      const v = (0.5 - lat / Math.PI) * sh - 0.5;
      sampleBilinear(src.data, sw, sh, u, v, out, (y * w + x) * 4);
    }
  }
  return out;
}

/** Output height for a horizontal FOV at a fixed aspect ratio (default 4:3). */
export function perspectiveSize(width = 1024, aspect = 4 / 3) {
  const w = Math.max(64, Math.min(2048, Math.round(width)));
  return { width: w, height: Math.round(w / aspect) };
}

async function decodeToImageData(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === 'function') bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function encodeJpeg(rgba, width, height, quality = 0.86) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))), 'image/jpeg', quality);
  });
}

/** Browser-only: decode a panorama blob, render one view, return a JPEG blob. */
export async function reprojectPanoramaBlob(blob, view) {
  const src = await decodeToImageData(blob);
  const { width, height } = perspectiveSize(view.width);
  const rgba = renderPerspective(src, { ...view, width, height });
  return encodeJpeg(rgba, width, height);
}
