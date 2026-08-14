// Frontend terminal-session registry: StrictMode/in-flight dedup only. The
// one-PTY-per-project invariant itself lives in the Rust backend (terminal_open
// returns the existing live session id for a matching cwd).

export interface TerminalSession {
  termId: number | null;
  opening: Promise<number> | null;
  exited: boolean;
}

export type TerminalOpener = (cwd: string) => Promise<number>;

export class TerminalSessionRegistry {
  private sessions = new Map<string, TerminalSession>();
  private readonly opener: TerminalOpener;

  constructor(opener: TerminalOpener) {
    this.opener = opener;
  }

  /** Idempotent: concurrent calls share one in-flight open; settled live
      sessions are reused; exited sessions reopen. */
  open(cwd: string): Promise<number> {
    const existing = this.sessions.get(cwd);
    if (existing) {
      if (existing.opening) {
        return existing.opening;
      }
      if (existing.termId !== null && !existing.exited) {
        return Promise.resolve(existing.termId);
      }
    }
    const session: TerminalSession = { termId: null, opening: null, exited: false };
    session.opening = this.opener(cwd).then(
      (termId) => {
        session.termId = termId;
        session.opening = null;
        return termId;
      },
      (error: unknown) => {
        // A failed open must not wedge the slot: drop it so a retry re-opens.
        this.sessions.delete(cwd);
        throw error;
      },
    );
    this.sessions.set(cwd, session);
    return session.opening;
  }

  markExited(termId: number): void {
    for (const session of this.sessions.values()) {
      if (session.termId === termId) {
        session.exited = true;
      }
    }
  }

  /** Forget a session (after terminal_close/Restart) so open() starts fresh. */
  drop(cwd: string): void {
    this.sessions.delete(cwd);
  }

  get(cwd: string): TerminalSession | undefined {
    return this.sessions.get(cwd);
  }
}
