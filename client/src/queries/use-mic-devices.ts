import { microphoneAdapter, type MicrophoneAdapter } from "@/bridge/microphone";
import type { MicrophoneInfo } from "@/types/MicrophoneInfo";
import { useQuery } from "@tanstack/react-query";
import { MIC_DEVICES } from "./keys";

export interface MicDevice {
  deviceId: string;
  label: string;
}

const MIC_DEVICE_CACHE_MS = 60_000;

async function listMicDevices(adapter: MicrophoneAdapter): Promise<MicDevice[]> {
  const mics = await adapter.listDevices();
  // Map MicrophoneInfo to MicDevice format, formatting the label to show audio host for non-browser devices.
  // This helps users distinguish between devices on different audio APIs (WASAPI vs ASIO on Windows, etc.)
  return mics.map(({ id, name, host }: MicrophoneInfo) => ({
    deviceId: id,
    // Use just the device name for browser sources, but prefix other devices with their audio host
    label: host === "Browser" ? name : `${host}: ${name}`,
  }));
}

export function useMicDevices(adapter: MicrophoneAdapter = microphoneAdapter) {
  return useQuery({
    queryKey: MIC_DEVICES,
    queryFn: () => listMicDevices(adapter),
    staleTime: MIC_DEVICE_CACHE_MS,
    cacheTime: MIC_DEVICE_CACHE_MS,
    initialData: [],
  }).data;
}
