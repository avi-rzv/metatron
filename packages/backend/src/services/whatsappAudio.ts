import { spawn } from 'child_process';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { transcribeAudio } from './voiceTranscription.js';
import type { AppSettings } from './settings.js';

export type AudioProvider = 'openai' | 'gemini' | null;

export interface TranscriptionResult {
  /** 'transcript' = text was extracted, 'raw' = raw buffer for multimodal */
  type: 'transcript' | 'raw';
  text?: string;
  audioBuffer?: Buffer;
  audioMimeType?: string;
}

/**
 * Determine which audio provider to use based on available API keys.
 * Prefers OpenAI (Whisper is specialized for speech) when available.
 */
export function getAudioProvider(settings: AppSettings): AudioProvider {
  if (settings.apiKeys.openai.apiKey) return 'openai';
  if (settings.apiKeys.gemini.apiKey) return 'gemini';
  return null;
}

/**
 * Process an incoming voice message.
 * - OpenAI path: transcribe with Whisper → return text
 * - Gemini path: return raw buffer for multimodal input
 */
export async function processIncomingVoice(
  audioBuffer: Buffer,
  mimeType: string,
  settings: AppSettings,
): Promise<TranscriptionResult> {
  const provider = getAudioProvider(settings);

  if (provider === 'openai') {
    const transcript = await transcribeAudio(
      settings.apiKeys.openai.apiKey,
      audioBuffer,
      mimeType,
    );
    return { type: 'transcript', text: transcript };
  }

  if (provider === 'gemini') {
    // Return raw buffer — Gemini handles audio natively as multimodal input
    return { type: 'raw', audioBuffer, audioMimeType: mimeType };
  }

  throw new Error('No audio provider available (need OpenAI or Gemini API key)');
}

/**
 * Convert text to a voice note (OGG/Opus) suitable for WhatsApp PTT.
 * - OpenAI path: TTS API with opus output
 * - Gemini path: Gemini TTS → PCM → ffmpeg → OGG/Opus
 */
export async function textToVoiceNote(
  text: string,
  settings: AppSettings,
): Promise<Buffer> {
  const provider = getAudioProvider(settings);

  if (provider === 'openai') {
    return openaiTTS(text, settings.apiKeys.openai.apiKey);
  }

  if (provider === 'gemini') {
    return geminiTTS(text, settings.apiKeys.gemini.apiKey);
  }

  throw new Error('No TTS provider available (need OpenAI or Gemini API key)');
}

/**
 * OpenAI TTS — returns OGG/Opus directly (no ffmpeg needed).
 */
async function openaiTTS(text: string, apiKey: string): Promise<Buffer> {
  const openai = new OpenAI({ apiKey });

  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: 'alloy',
    input: text,
    response_format: 'opus',
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Gemini TTS — uses gemini-2.5-flash-preview-tts with audio output,
 * then converts PCM to OGG/Opus via ffmpeg.
 */
async function geminiTTS(text: string, apiKey: string): Promise<Buffer> {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Kore',
          },
        },
      },
    },
  });

  // Extract PCM audio data from the response
  const audioPart = response.candidates?.[0]?.content?.parts?.find(
    (p: any) => p.inlineData?.mimeType?.startsWith('audio/'),
  );

  if (!audioPart || !(audioPart as any).inlineData) {
    throw new Error('Gemini TTS returned no audio data');
  }

  const { data, mimeType } = (audioPart as any).inlineData as { data: string; mimeType: string };
  const pcmBuffer = Buffer.from(data, 'base64');

  // Gemini TTS outputs PCM (s16le, 24kHz, mono) — convert to OGG/Opus
  return convertToOggOpus(pcmBuffer, 'pcm');
}

/**
 * Convert audio to OGG/Opus using ffmpeg (spawns child process).
 * For PCM input: assumes signed 16-bit little-endian, 24kHz, mono.
 */
export function convertToOggOpus(input: Buffer, inputFormat: 'pcm' | 'ogg' | 'webm' | 'mp3' | 'wav'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const inputArgs = inputFormat === 'pcm'
      ? ['-f', 's16le', '-ar', '24000', '-ac', '1']
      : [];

    const args = [
      ...inputArgs,
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-f', 'ogg',
      'pipe:1',
    ];

    const proc = spawn('ffmpeg', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const chunks: Buffer[] = [];
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`ffmpeg spawn failed: ${err.message}. Is ffmpeg installed?`));
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}
