import { create } from 'zustand';

type Toast = {
  id: number;
  variant: 'success' | 'info';
  message: string;
};

type ToastStoreState = {
  toasts: Toast[];
  dismiss: (id: number) => void;
};

const TOAST_DURATION_MS = 5_000;

export const useToastStore = create<ToastStoreState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

let nextToastId = 1;

export const showToast = (toast: Omit<Toast, 'id'>) => {
  const id = nextToastId++;
  useToastStore.setState((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
  setTimeout(() => useToastStore.getState().dismiss(id), TOAST_DURATION_MS);
};
