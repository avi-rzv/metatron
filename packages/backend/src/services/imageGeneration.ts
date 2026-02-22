import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { nanoid } from 'nanoid';
import { writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import type { AppSettings } from './settings.js';

const MEDIA_DIR = './data/media';

interface GenerateResult {
  base64: string;
  mimeType: string;
  modelUsed: string;
}

interface SaveResult {
  filename: string;
  filepath: string;
  size: number;
}

function mimeToExt(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

async function generateImageWithGemini(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<{ base64: string; mimeType: string }> {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error('No response parts from Gemini image generation');

  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType ?? 'image/png',
      };
    }
  }

  throw new Error('No image data in Gemini response');
}

async function generateImageWithOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<{ base64: string; mimeType: string }> {
  const client = new OpenAI({ apiKey });

  // gpt-image models return b64_json by default and don't support response_format
  const isGptImage = model.startsWith('gpt-image');

  const response = await client.images.generate({
    model,
    prompt,
    n: 1,
    size: '1024x1024',
    ...(!isGptImage && { response_format: 'b64_json' as const }),
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image data in OpenAI response');

  return { base64: b64, mimeType: 'image/png' };
}

function getProviderForImageModel(modelId: string): 'gemini' | 'openai' {
  if (modelId.startsWith('gemini')) return 'gemini';
  return 'openai';
}

export async function generateImage(
  prompt: string,
  settings: AppSettings,
): Promise<GenerateResult> {
  const modelsToTry = [
    settings.primaryImageModel,
    ...settings.fallbackImageModels,
  ];

  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    const provider = getProviderForImageModel(model);
    const apiKey = settings.apiKeys[provider]?.apiKey;

    if (!apiKey) {
      lastError = new Error(`No API key for ${provider}`);
      continue;
    }

    try {
      const result =
        provider === 'gemini'
          ? await generateImageWithGemini(apiKey, model, prompt)
          : await generateImageWithOpenAI(apiKey, model, prompt);

      return { ...result, modelUsed: model };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[imageGen] Failed with model ${model}:`, lastError.message);
    }
  }

  throw lastError ?? new Error('No image models configured');
}

export async function loadImageFromDisk(
  filename: string,
): Promise<{ base64: string; mimeType: string }> {
  const filepath = join(MEDIA_DIR, filename);
  const buffer = await readFile(filepath);
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'png';
  let mimeType = 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
  else if (ext === 'webp') mimeType = 'image/webp';
  return { base64: buffer.toString('base64'), mimeType };
}

async function editImageWithGemini(
  apiKey: string,
  model: string,
  prompt: string,
  sourceBase64: string,
  sourceMimeType: string,
): Promise<{ base64: string; mimeType: string }> {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { data: sourceBase64, mimeType: sourceMimeType } },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error('No response parts from Gemini image edit');

  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType ?? 'image/png',
      };
    }
  }

  throw new Error('No image data in Gemini edit response');
}

async function editImageWithOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  sourceBuffer: Buffer,
  sourceMimeType: string,
): Promise<{ base64: string; mimeType: string }> {
  const client = new OpenAI({ apiKey });

  const ext = mimeToExt(sourceMimeType);
  const file = new File([new Uint8Array(sourceBuffer)], `source.${ext}`, { type: sourceMimeType });

  const response = await client.images.edit({
    model,
    image: file,
    prompt,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (b64) {
    return { base64: b64, mimeType: 'image/png' };
  }

  // Some models return URL instead of b64
  const url = response.data?.[0]?.url;
  if (url) {
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    return {
      base64: Buffer.from(arrayBuf).toString('base64'),
      mimeType: 'image/png',
    };
  }

  throw new Error('No image data in OpenAI edit response');
}

export async function editImage(
  prompt: string,
  sourceBase64: string,
  sourceMimeType: string,
  settings: AppSettings,
): Promise<GenerateResult> {
  const modelsToTry = [
    settings.primaryImageModel,
    ...settings.fallbackImageModels,
  ];

  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    const provider = getProviderForImageModel(model);
    const apiKey = settings.apiKeys[provider]?.apiKey;

    if (!apiKey) {
      lastError = new Error(`No API key for ${provider}`);
      continue;
    }

    try {
      const result =
        provider === 'gemini'
          ? await editImageWithGemini(apiKey, model, prompt, sourceBase64, sourceMimeType)
          : await editImageWithOpenAI(apiKey, model, prompt, Buffer.from(sourceBase64, 'base64'), sourceMimeType);

      return { ...result, modelUsed: model };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[imageEdit] Failed with model ${model}:`, lastError.message);
    }
  }

  throw lastError ?? new Error('No image models configured');
}

export async function saveImageToDisk(
  base64: string,
  mimeType: string,
): Promise<SaveResult> {
  const ext = mimeToExt(mimeType);
  const filename = `${nanoid()}.${ext}`;
  const filepath = join(MEDIA_DIR, filename);

  const buffer = Buffer.from(base64, 'base64');
  await writeFile(filepath, buffer);

  const fileStat = await stat(filepath);

  return { filename, filepath, size: fileStat.size };
}
