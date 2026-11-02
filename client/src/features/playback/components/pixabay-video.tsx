import { useEffect } from 'react';

import { useBackgroundLifecycle } from '@/features/playback/components/background-lifecycle-context';
import { usePixabaySlots } from '@/features/playback/hooks/use-pixabay-slots';
import type { VideoFlavor } from '@/features/playback/lib/video-flavor';
import { VIDEO_CLASS_NAME } from '@/features/playback/lib/video-styles';

type PixabayVideoProps = {
  flavor: VideoFlavor;
  isPlaying: boolean;
};

export const PixabayVideo = ({ flavor, isPlaying }: PixabayVideoProps) => {
  const { ready } = useBackgroundLifecycle();
  const { slots, onActiveEnded } = usePixabaySlots(flavor, isPlaying);
  const activeSlot = slots.find((slot) => slot.isActive);
  const activeRef = activeSlot?.ref;
  const activeSrc = activeSlot?.src ?? '';

  useEffect(() => {
    const video = activeRef?.current;
    if (
      activeSrc !== '' &&
      video !== null &&
      video !== undefined &&
      video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      ready();
    }
  }, [activeRef, activeSrc, ready]);

  return (
    <>
      {slots.map((slot) => (
        <video
          key={slot.id}
          ref={slot.ref}
          className={VIDEO_CLASS_NAME}
          style={{ visibility: slot.isActive ? 'visible' : 'hidden' }}
          src={slot.src || undefined}
          preload="auto"
          muted
          playsInline
          onCanPlay={slot.isActive ? ready : undefined}
          onEnded={slot.isActive ? onActiveEnded : undefined}
          onError={slot.isActive ? onActiveEnded : undefined}
        />
      ))}
    </>
  );
};
