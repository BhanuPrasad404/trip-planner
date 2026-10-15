// Shrinks a screenshot in the browser before upload: far cheaper/faster, and keeps us under size limits.
export async function fileToDataUrl(file: File, maxSide = 1600, quality = 0.82): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image. Try a JPG or PNG screenshot.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser couldn't process that image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * All screenshots of one import travel in ONE request, and hosting platforms cap a request's size (Vercel's functions: 4.5 MB). Three
 * dense screenshots at full quality can exceed that and the person would just see a failed request. So each new picture is shrunk in
 * steps until the whole set fits; if it still cannot fit, we say so in plain words BEFORE sending anything.
 */
export const IMAGE_BUDGET_CHARS = 3_600_000;
const STEPS: [number, number][] = [[1600, 0.82], [1280, 0.7], [1000, 0.6]];

export async function fileToBudgetedDataUrl(file: File, usedChars: number, compress: typeof fileToDataUrl = fileToDataUrl, budget = IMAGE_BUDGET_CHARS): Promise<string> {
  for (const [side, quality] of STEPS) {
    const url = await compress(file, side, quality);
    if (usedChars + url.length <= budget) return url;
  }
  throw new Error("These screenshots are too large to send together. Remove one, or crop the picture to just the text.");
}
