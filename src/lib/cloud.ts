import { AspectRatio, Language } from './types';

interface SyncCreateResponse {
  id?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function generateLipSyncVideoWithSync(
  apiToken: string,
  inputImageDataUrl: string,
  audioBlob: Blob,
  language: Language,
  aspectRatio: AspectRatio,
): Promise<string> {
  const audioFile = new File([audioBlob], 'voice.mp3', { type: 'audio/mpeg' });
  const imageBlob = await (await fetch(inputImageDataUrl)).blob();
  const imageFile = new File([imageBlob], 'avatar.png', { type: 'image/png' });

  const form = new FormData();
  form.append('model', 'lipsync-2');
  form.append('input_image', imageFile);
  form.append('input_audio', audioFile);
  form.append('output_format', 'mp4');
  form.append('language', language);
  form.append('aspect_ratio', aspectRatio);

  const createRes = await fetch('https://api.sync.so/v2/generate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    body: form,
  });

  if (!createRes.ok) {
    throw new Error(`Sync create failed: ${createRes.status} ${await createRes.text()}`);
  }

  const createData = (await createRes.json()) as SyncCreateResponse;
  if (!createData.id) throw new Error('Sync create failed: missing id');

  for (let i = 0; i < 60; i += 1) {
    await sleep(3000);
    const pollRes = await fetch(`https://api.sync.so/v2/generate/${createData.id}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!pollRes.ok) {
      throw new Error(`Sync poll failed: ${pollRes.status} ${await pollRes.text()}`);
    }

    const pollData = (await pollRes.json()) as Record<string, unknown>;
    const status = String(pollData.status ?? '');
    if (status === 'COMPLETED' || status === 'completed') {
      const outputUrl = String((pollData.outputUrl ?? pollData.output_url ?? '') as string);
      if (!outputUrl) throw new Error('Sync completed but output URL missing');
      return outputUrl;
    }

    if (status === 'FAILED' || status === 'failed') {
      throw new Error(`Sync generation failed: ${JSON.stringify(pollData)}`);
    }
  }

  throw new Error('Sync generation timeout (3min)');
}
