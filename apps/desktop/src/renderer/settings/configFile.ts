import type { ConfigFileName } from '@shared/types';

export type { ConfigFileName };

/** Raw access to a config file; the sidecar in the app, a fake in tests. */
export interface ConfigFileIO {
  read: (file: ConfigFileName) => Promise<string | null>;
  write: (file: ConfigFileName, text: string) => Promise<void>;
}

/**
 * Writes one config file. `schedule` debounces; `flush` writes now. Writes
 * never overlap and the latest text always wins. A failed write stays pending
 * (unless newer text replaced it) and goes out with the next flush.
 */
export class ConfigFileWriter {
  onError: ((err: unknown) => void) | null = null;
  onSaved: (() => void) | null = null;

  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly file: ConfigFileName,
    private readonly io: ConfigFileIO,
    private readonly delayMs = 300,
  ) {}

  schedule(text: string): void {
    this.pending = text;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight) await this.inFlight;
    const text = this.pending;
    if (text === null) return;
    this.pending = null;

    this.inFlight = this.io.write(this.file, text).then(
      () => { this.onSaved?.(); },
      (err: unknown) => {
        if (this.pending === null) this.pending = text;
        this.onError?.(err);
      },
    ).finally(() => { this.inFlight = null; });
    await this.inFlight;
  }
}
