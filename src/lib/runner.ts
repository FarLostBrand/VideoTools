import { invoke } from "@tauri-apps/api/core";

export interface RunOptions {
  onLine: (line: string) => void;
  onDone: (code: number | null) => void;
}

export interface CancelHandle {
  cancel: () => void;
}

let _counter = 0;

export function runCommand(
  program: string,
  args: string[],
  opts: RunOptions
): CancelHandle {
  const eventId = `proc_${Date.now()}_${_counter++}`;
  let cancelled = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    invoke("cleanup_process", { eventId }).catch(() => {});
  };

  // Start the process
  invoke("start_process", { program, args, eventId })
    .then(() => {
      // Poll every 100ms for new lines and done status
      intervalId = setInterval(async () => {
        if (cancelled) { stop(); return; }

        try {
          const [lines, done] = await invoke<[string[], number | null]>(
            "poll_process", { eventId }
          );

          for (const line of lines) {
            if (line.trim()) opts.onLine(line);
          }

          if (done !== null && done !== undefined) {
            stop();
            opts.onDone(done);
          }
        } catch (e) {
          stop();
          opts.onLine(`[ERROR] Poll failed: ${e}`);
          opts.onDone(-1);
        }
      }, 100);
    })
    .catch((err) => {
      opts.onLine(`[ERROR] ${err}`);
      opts.onDone(-1);
    });

  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      stop();
      opts.onLine("[WARN] Cancelled.");
      opts.onDone(null);
    },
  };
}
