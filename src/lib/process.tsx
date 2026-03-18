import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from "react";
import { runCommand, type CancelHandle } from "./runner";
import { classifyLine, type LogLine } from "../components/LogOutput";

export type ProcessStatus = "idle" | "running" | "done" | "error";

export interface ProcessState {
  lines: LogLine[];
  status: ProcessStatus;
  background: boolean;
}


type SlotKey = string;

interface ProcessContextType {
  getSlot: (key: SlotKey) => ProcessState;
  isRunning: (key: SlotKey) => boolean;
  anyRunning: () => boolean;
  start: (
    key: SlotKey,
    program: string,
    args: string[],
    background: boolean,
    onDone?: (code: number | null) => void
  ) => void;
  cancel: (key: SlotKey) => void;
  clearLines: (key: SlotKey) => void;
  setBackground: (key: SlotKey, bg: boolean) => void;
}

const ProcessContext = createContext<ProcessContextType | null>(null);

export function ProcessProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Record<SlotKey, ProcessState>>({});
  const cancelRefs = useRef<Record<SlotKey, CancelHandle | null>>({});

  const updateSlot = useCallback((key: SlotKey, patch: Partial<ProcessState>) => {
    setSlots((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { lines: [], status: "idle", background: false }), ...patch },
    }));
  }, []);

  const getSlot = useCallback((key: SlotKey): ProcessState => {
    return slots[key] ?? { lines: [], status: "idle", background: false };
  }, [slots]);

  const isRunning = useCallback((key: SlotKey) => {
    return slots[key]?.status === "running";
  }, [slots]);

  const anyRunning = useCallback(() => {
    return Object.values(slots).some((s) => s.status === "running");
  }, [slots]);

  const start = useCallback((
    key: SlotKey,
    program: string,
    args: string[],
    background: boolean,
    onDone?: (code: number | null) => void
  ) => {
    updateSlot(key, { lines: [], status: "running", background });

    const handle = runCommand(program, args, {
      onLine: (raw) => {
        if (!raw.trim()) return;
        setSlots((prev) => {
          const slot = prev[key] ?? { lines: [], status: "running", background: false };
          return { ...prev, [key]: { ...slot, lines: [...slot.lines, classifyLine(raw)] } };
        });
      },
      onDone: (code) => {
        const newStatus: ProcessStatus = code === null ? "idle" : code === 0 ? "done" : "error";
        const msg = code === null ? "[WARN] Cancelled."
          : code === 0 ? "[DONE] Complete."
          : `[ERROR] Exited with code ${code}`;
        setSlots((prev) => {
          const slot = prev[key] ?? { lines: [], status: "running", background: false };
          return { ...prev, [key]: { ...slot, status: newStatus, lines: [...slot.lines, classifyLine(msg)] } };
        });
        cancelRefs.current[key] = null;
        onDone?.(code);
      },
    });

    cancelRefs.current[key] = handle;
  }, [updateSlot]);

  const cancel = useCallback((key: SlotKey) => {
    cancelRefs.current[key]?.cancel();
    cancelRefs.current[key] = null;
  }, []);

  const clearLines = useCallback((key: SlotKey) => {
    updateSlot(key, { lines: [] });
  }, [updateSlot]);

  const setBackground = useCallback((key: SlotKey, bg: boolean) => {
    updateSlot(key, { background: bg });
  }, [updateSlot]);

  return (
    <ProcessContext.Provider value={{ getSlot, isRunning, anyRunning, start, cancel, clearLines, setBackground }}>
      {children}
    </ProcessContext.Provider>
  );
}

export function useProcess(key: SlotKey) {
  const ctx = useContext(ProcessContext);
  if (!ctx) throw new Error("useProcess must be used within ProcessProvider");
  return {
    state:         ctx.getSlot(key),
    isRunning:     ctx.isRunning(key),
    anyRunning:    ctx.anyRunning,
    start:         (program: string, args: string[], background: boolean, onDone?: (code: number | null) => void) =>
                     ctx.start(key, program, args, background, onDone),
    cancel:        () => ctx.cancel(key),
    clearLines:    () => ctx.clearLines(key),
    setBackground: (bg: boolean) => ctx.setBackground(key, bg),
  };
}
