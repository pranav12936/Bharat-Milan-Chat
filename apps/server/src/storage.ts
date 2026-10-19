
import { v2 as cloudinary } from 'cloudinary';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

export type MediaType = 'image' | 'video';

const approved = new Map<string, MediaType>([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/webp', 'image'],
  ['video/mp4', 'video'],
  ['video/webm', 'video'],
]);

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
  secure: true,
});

function assertConfigured(): void {
  if (
    !config.CLOUDINARY_CLOUD_NAME ||
    !config.CLOUDINARY_API_KEY ||
    !config.CLOUDINARY_API_SECRET
  ) {
    throw new Error(
      'Cloudinary is not configured. Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the project-root .env file.',
    );
  }
}

export function validateMedia(
  contentType: string,
  bytes: number,
): MediaType {
  const mediaType = approved.get(contentType);

  if (!mediaType) {
    throw new Error(
      'Only JPEG, PNG, WebP, MP4 and WebM files are permitted.',
    );
  }

  const maxBytes =
    mediaType === 'image'
      ? config.MAX_IMAGE_BYTES
      : config.MAX_VIDEO_BYTES;

  if (
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > maxBytes
  ) {
    throw new Error(
      'File is empty or exceeds the configured size limit.',
    );
  }

  return mediaType;
}

type StoredMedia = {
  provider: 'cloudinary';
  publicId: string;
  resourceType: MediaType;
  format: string;
};

export async function saveMedia(
  conversationId: string,
  mediaType: MediaType,
  contentType: string,
  bytes: Buffer,
): Promise<string> {
  assertConfigured();
  validateMedia(contentType, bytes.length);

  const publicId =
    `conversations/${conversationId}/${randomUUID()}`;

  const dataUri =
    `data:${contentType};base64,${bytes.toString('base64')}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    resource_type: mediaType,
    type: 'private',
    public_id: publicId,
    overwrite: false,
    unique_filename: false,
  });

  const stored: StoredMedia = {
    provider: 'cloudinary',
    publicId: result.public_id,
    resourceType: mediaType,
    format: result.format,
  };

  // Preserve the existing database schema and API contract.
  return JSON.stringify(stored);
}

export async function mediaUrl(
  objectKey: string,
): Promise<string> {
  assertConfigured();

  let stored: StoredMedia;

  try {
    stored = JSON.parse(objectKey) as StoredMedia;
  } catch {
    throw new Error(
      'This media record uses the previous Google Cloud Storage format and has not been migrated.',
    );
  }

  if (
    stored.provider !== 'cloudinary' ||
    typeof stored.publicId !== 'string' ||
    !stored.publicId ||
    (stored.resourceType !== 'image' &&
      stored.resourceType !== 'video') ||
    typeof stored.format !== 'string' ||
    !stored.format
  ) {
    throw new Error('Invalid Cloudinary media reference.');
  }

  const expiresAt =
    Math.floor(Date.now() / 1000) +
    config.CLOUDINARY_SIGNED_URL_TTL_SECONDS;

  return cloudinary.utils.private_download_url(
    stored.publicId,
    stored.format,
    {
      resource_type: stored.resourceType,
      type: 'private',
      expires_at: expiresAt,
    },
  );
}
