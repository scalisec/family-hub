// Gets phone or PC photos ready for the wall: turned the right way up, shrunk to screen size
// (about 1920 px, a few hundred KB) plus a small preview for the app's photo grid.
const BIG = 1920;
const SMALL = 280;

export const isImage = (f) => /^image\/(jpeg|png|webp|gif|bmp)$/i.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
export const isHeic = (f) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
export const photoKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error("Couldn't read that photo."));
    r.readAsDataURL(blob);
  });
}

async function shrink(bitmap, max, quality) {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const hgt = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, hgt);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error("Couldn't shrink that photo.");
  return { data: await toBase64(blob), w, h: hgt };
}

export async function prepare(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
    throw new Error(isHeic(file) ? `${file.name} is an iPhone-style HEIC photo this browser can't open.` : `Couldn't open ${file.name}.`);
  }
  try {
    const big = await shrink(bitmap, BIG, 0.82);
    const small = await shrink(bitmap, SMALL, 0.7);
    return { name: file.name, key: photoKey(file), data: big.data, thumb: small.data, w: big.w, h: big.h };
  } finally {
    if (bitmap.close) bitmap.close();
  }
}
