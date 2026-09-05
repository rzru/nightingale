import { z } from 'zod';

import { selectFolderPath } from './folder';
import { invoke } from './runtime';

export const selectRecordingsFolder = async (): Promise<string | undefined> => {
  return await selectFolderPath({
    message: 'Recordings folder path (visible to the server)',
    defaultPath: '/recordings',
  });
};

const blobBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read the recording'));
        return;
      }

      const separator = reader.result.indexOf(',');
      if (separator < 0) {
        reject(new Error('Could not encode the recording'));
        return;
      }

      resolve(reader.result.slice(separator + 1));
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Read failed')));
    reader.readAsDataURL(blob);
  });

type SaveRecordingInput = {
  title: string;
  album: string;
  profile: string;
  savedAt: string;
  mediaType: string;
  audio: Blob;
  microphoneAudio: Blob | null;
};

export const saveRecording = async (input: SaveRecordingInput): Promise<string> => {
  const audioBase64 = await blobBase64(input.audio);
  const microphoneAudioBase64 =
    input.microphoneAudio === null ? null : await blobBase64(input.microphoneAudio);
  const result: unknown = await invoke('save_recording', {
    title: input.title,
    album: input.album,
    profile: input.profile,
    savedAt: input.savedAt,
    mediaType: input.mediaType,
    audioBase64,
    microphoneAudioBase64,
  });

  return z.string().parse(result);
};
