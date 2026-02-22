import type { FastifyInstance } from 'fastify';
import { getDecryptedSettings } from '../services/settings.js';
import { transcribeAudio, saveAudioToDisk } from '../services/voiceTranscription.js';

export async function voiceRoutes(fastify: FastifyInstance) {
  // POST /api/voice/transcribe — accept multipart audio, save to disk, transcribe via Whisper
  fastify.post('/api/voice/transcribe', async (req, reply) => {
    const data = await req.file();
    if (!data) {
      reply.status(400).send({ error: 'No audio file provided' });
      return;
    }

    const buffer = await data.toBuffer();
    const mimeType = data.mimetype;

    if (!mimeType.startsWith('audio/')) {
      reply.status(400).send({ error: 'File must be an audio type' });
      return;
    }

    const settings = await getDecryptedSettings();
    const apiKey = settings.apiKeys.openai.apiKey;
    if (!apiKey) {
      reply.status(400).send({ error: 'OpenAI API key not configured' });
      return;
    }

    const { filename, size } = await saveAudioToDisk(buffer, mimeType);
    const transcription = await transcribeAudio(apiKey, buffer, mimeType);

    return { transcription, filename, mimeType, size };
  });
}
