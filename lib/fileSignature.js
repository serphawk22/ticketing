import sharp from 'sharp';

// Maximum dimensions to prevent decompression bombs / memory exhaustion
const MAX_DIMENSION = 4096;
const MAX_MEGAPIXELS = 16 * 1024 * 1024; // 16 million pixels

/**
 * Validates the file buffer against standard binary image signatures (magic bytes).
 *
 * @param {Buffer} buffer
 * @returns {'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null}
 */
export function getImageTypeFromBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG / JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: 47 49 46 38 ('GIF8')
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Validates magic bytes, checks dimensions, decodes and re-encodes an image
 * buffer into a clean PNG. Strips all embedded EXIF metadata, ICC profiles,
 * and polyglot payloads.
 *
 * @param {Buffer} buffer - Raw uploaded file buffer
 * @returns {Promise<{ buffer: Buffer, contentType: string, extension: string, width: number, height: number }>}
 */
export async function sanitizeAndReencodeImage(buffer) {
  const detectedType = getImageTypeFromBuffer(buffer);
  if (!detectedType) {
    throw new Error('Unsupported or invalid image file signature. Allowed formats: PNG, JPEG, GIF, WebP.');
  }

  let image = sharp(buffer, { failOnError: true });
  const meta = await image.metadata();

  if (!meta || !meta.width || !meta.height) {
    throw new Error('Image could not be safely decoded or is corrupted.');
  }

  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
    throw new Error(`Image dimensions exceed maximum allowed size (${MAX_DIMENSION}x${MAX_DIMENSION}px).`);
  }

  if (meta.width * meta.height > MAX_MEGAPIXELS) {
    throw new Error('Image total resolution is too large.');
  }

  // Safe re-encode to clean PNG, stripping metadata and normalizing pixels
  const sanitizedBuffer = await image
    .png({ compressionLevel: 8 })
    .toBuffer();

  return {
    buffer: sanitizedBuffer,
    contentType: 'image/png',
    extension: '.png',
    width: meta.width,
    height: meta.height,
  };
}

