import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getUserProfile, updateAvatar, deleteAvatar } from '@/lib/profiles';
import { putAttachment, readAttachment, deleteAttachment, usesRemoteStorage, presignedAttachmentUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * Checks image magic bytes to prevent spoofed file extensions.
 */
function isValidImageBytes(buffer, mimeType) {
  if (!buffer || buffer.length < 4) return false;
  // JPEG: FF D8 FF
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  // PNG: 89 50 4E 47
  if (mimeType === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  // GIF: GIF87a or GIF89a (47 49 46 38)
  if (mimeType === 'image/gif') {
    return (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    );
  }
  // WebP: RIFF ... WEBP
  if (mimeType === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  return false;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requestedUserId = searchParams.get('userId') || searchParams.get('u');

  let targetUserId = null;
  if (requestedUserId) {
    targetUserId = Number(requestedUserId);
  } else {
    const session = await requireAuth();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    targetUserId = session.user.id;
  }

  const profile = await getUserProfile(targetUserId);
  if (!profile || !profile.avatar_storage_key) {
    return NextResponse.json({ error: 'Avatar not found.' }, { status: 404 });
  }

  if (usesRemoteStorage()) {
    try {
      const presigned = await presignedAttachmentUrl(profile.avatar_storage_key, 3600);
      return NextResponse.redirect(presigned);
    } catch {
      // Fall through to streaming
    }
  }

  try {
    const fileBytes = await readAttachment(profile.avatar_storage_key);
    let contentType = 'image/jpeg';
    if (profile.avatar_storage_key.endsWith('.png')) contentType = 'image/png';
    else if (profile.avatar_storage_key.endsWith('.gif')) contentType = 'image/gif';
    else if (profile.avatar_storage_key.endsWith('.webp')) contentType = 'image/webp';

    return new NextResponse(fileBytes, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileBytes.length),
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('[avatar/GET] Could not read avatar file:', error.message);
    return NextResponse.json({ error: 'Avatar file missing.' }, { status: 404 });
  }
}

export async function POST(request) {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Please choose an image file to upload.' }, { status: 400 });
    }

    if (file.size > MAX_AVATAR_BYTES) {
      return NextResponse.json(
        { error: 'Avatar image must be smaller than 5MB.' },
        { status: 400 }
      );
    }

    const mimeType = (file.type || '').toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: 'Allowed image types are JPG, PNG, GIF, and WebP.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (!isValidImageBytes(buffer, mimeType)) {
      return NextResponse.json(
        { error: 'Invalid or corrupted image file content.' },
        { status: 400 }
      );
    }

    const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/gif' ? 'gif' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const storageKey = `avatars/user-${session.user.id}-${Date.now()}.${ext}`;

    await putAttachment(storageKey, buffer, mimeType);

    const avatarUrl = `/api/profile/avatar?u=${session.user.id}&v=${Date.now()}`;
    const updated = await updateAvatar(session.user.id, {
      avatar_url: avatarUrl,
      avatar_storage_key: storageKey,
    });

    return NextResponse.json({
      success: true,
      avatar_url: updated.avatar_url,
      profile: updated,
    });
  } catch (error) {
    console.error('[avatar/POST] Upload error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to upload profile picture.' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const session = await requireAuth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const oldKey = await deleteAvatar(session.user.id);
    if (oldKey) {
      await deleteAttachment(oldKey).catch(() => {});
    }
    const updated = await getUserProfile(session.user.id);
    return NextResponse.json({ success: true, profile: updated });
  } catch (error) {
    console.error('[avatar/DELETE] Error removing avatar:', error.message);
    return NextResponse.json({ error: 'Failed to remove avatar.' }, { status: 500 });
  }
}

