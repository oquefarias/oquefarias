export interface OptimizedImageResult {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  kb: number;
  mimeType: string;
  wasOriginalSlowWarning: boolean;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

export const MAX_ORIGINAL_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const SLOW_PROCESSING_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_DECODED_IMAGE_BYTES = 200 * 1024; // 200 KB server limit
export const SECOND_PASS_THRESHOLD_BYTES = 150 * 1024; // 150 KB client fallback threshold

export function validateProductImageFile(file: File): string | null {
  const mime = (file.type || '').toLowerCase().trim();
  const hasValidMime = ALLOWED_MIME_TYPES.has(mime);
  const hasValidExt = ALLOWED_EXTENSIONS.test(file.name || '');

  if (!hasValidMime && !hasValidExt) {
    return 'Formato não suportado. Envie apenas imagens JPG, PNG ou WebP.';
  }

  if (file.size > MAX_ORIGINAL_FILE_BYTES) {
    return 'O arquivo original passa de 10 MB. Escolha uma foto de até 10 MB.';
  }

  return null;
}

export function getDataUrlDecodedBytes(dataUrl: string): number {
  if (!dataUrl || !dataUrl.startsWith('data:')) return 0;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return 0;
  const base64 = dataUrl.slice(commaIdx + 1).replace(/\s/g, '');
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function renderAndEncode(
  img: HTMLImageElement,
  maxSide: number,
  quality: number
): { dataUrl: string; width: number; height: number; bytes: number; mimeType: string } {
  let width = img.naturalWidth || img.width || 600;
  let height = img.naturalHeight || img.height || 600;

  if (width > height) {
    if (width > maxSide) {
      height = Math.max(1, Math.round((height * maxSide) / width));
      width = maxSide;
    }
  } else {
    if (height > maxSide) {
      width = Math.max(1, Math.round((width * maxSide) / height));
      height = maxSide;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Não foi possível processar a imagem no navegador.');
  }

  // Fill white background for clean product look and JPEG compatibility
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  // Try WebP first; fallback to JPEG if browser does not support WebP canvas encoding
  let dataUrl = canvas.toDataURL('image/webp', quality);
  let mimeType = 'image/webp';
  if (!dataUrl.startsWith('data:image/webp')) {
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    mimeType = 'image/jpeg';
  }

  const bytes = getDataUrlDecodedBytes(dataUrl);
  return { dataUrl, width, height, bytes, mimeType };
}

export function optimizeLoadedImage(
  img: HTMLImageElement,
  wasOriginalSlowWarning = false
): OptimizedImageResult {
  // Pass 1: max side 600px, quality 0.75 (WebP or JPEG fallback)
  let current = renderAndEncode(img, 600, 0.75);

  // Pass 2 (Requirement 2.c): if > 150 KB, reduce further to max side 480px, quality 0.6
  if (current.bytes > SECOND_PASS_THRESHOLD_BYTES) {
    current = renderAndEncode(img, 480, 0.6);
  }

  // Safety pass so it never exceeds the 200 KB server limit
  if (current.bytes > MAX_DECODED_IMAGE_BYTES) {
    current = renderAndEncode(img, 400, 0.5);
  }

  return {
    dataUrl: current.dataUrl,
    width: current.width,
    height: current.height,
    bytes: current.bytes,
    kb: Math.max(1, Math.round(current.bytes / 1024)),
    mimeType: current.mimeType,
    wasOriginalSlowWarning,
  };
}

export function optimizeProductImageFile(file: File): Promise<OptimizedImageResult> {
  const validationError = validateProductImageFile(file);
  if (validationError) {
    return Promise.reject(new Error(validationError));
  }

  const wasSlow = file.size > SLOW_PROCESSING_FILE_BYTES;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo da foto.'));
    reader.onload = (e) => {
      const src = e.target?.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo de imagem corrompido ou inválido.'));
      img.onload = () => {
        try {
          const result = optimizeLoadedImage(img, wasSlow);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export async function fetchAndOptimizeExistingProductImage(
  imageEndpointUrl: string
): Promise<{
  optimized: OptimizedImageResult;
  originalDecodedBytes: number;
  originalStorageBytes: number;
  newStorageBytes: number;
}> {
  const res = await fetch(imageEndpointUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Status ${res.status}`);
  }

  const headerStorageBytes = Number(res.headers.get('X-Image-Storage-Bytes') || 0);
  const headerDecodedBytes = Number(res.headers.get('X-Image-Decoded-Bytes') || 0);

  const blob = await res.blob();
  const originalDecodedBytes = headerDecodedBytes > 0 ? headerDecodedBytes : blob.size;
  const originalStorageBytes =
    headerStorageBytes > 0
      ? headerStorageBytes
      : Math.ceil((originalDecodedBytes * 4) / 3) + 24;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const optimized = await new Promise<OptimizedImageResult>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onerror = () => reject(new Error('Falha ao decodificar imagem.'));
      img.onload = () => {
        try {
          resolve(optimizeLoadedImage(img, false));
        } catch (err) {
          reject(err);
        }
      };
      img.src = objectUrl;
    });

    const newStorageBytes = optimized.dataUrl.length;
    return {
      optimized,
      originalDecodedBytes,
      originalStorageBytes,
      newStorageBytes,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function formatBytesCompactPtBr(bytes: number): string {
  const clean = Math.max(0, Math.round(bytes));
  if (clean >= 1024 * 1024) {
    const mb = clean / (1024 * 1024);
    return `${mb.toFixed(1).replace('.', ',')} MB`;
  }
  const kb = Math.max(1, Math.round(clean / 1024));
  return `${kb} KB`;
}
