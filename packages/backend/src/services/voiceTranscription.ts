import OpenAI from 'openai';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { nanoid } from 'nanoid';

const UPLOADS_DIR = './data/uploads';

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/wave': '.wav',
};

export async function transcribeAudio(
  apiKey: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const openai = new OpenAI({ apiKey });
  const ext = MIME_TO_EXT[mimeType] ?? '.webm';
  const file = new File([buffer as unknown as BlobPart], `audio${ext}`, { type: mimeType });

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
  });

  return response.text;
}

export async function saveAudioToDisk(
  buffer: Buffer,
  mimeType: string
): Promise<{ filename: string; size: number }> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const ext = MIME_TO_EXT[mimeType] ?? '.webm';
  const filename = nanoid() + ext;
  const filepath = join(UPLOADS_DIR, filename);
  await writeFile(filepath, buffer);
  return { filename, size: buffer.length };
}
