import { create } from 'zustand';
import type { AvailabilityStreamStatus } from '@/api/program/run-availability-stream';

type AvailabilityStreamStoreState = {
  status: AvailabilityStreamStatus;
  setStatus: (status: AvailabilityStreamStatus) => void;
};

export const useAvailabilityStreamStore = create<AvailabilityStreamStoreState>()((set) => ({
  status: 'connecting',
  setStatus: (status) => set({ status }),
}));
