import { execFile } from "node:child_process";
import { basename } from "node:path";
import { TmuxSession, TreeSnapshot } from "../webview/sidebar/types";

const TMUX_LIST_FORMAT =
  "#{session_name}\t#{session_attached}\t#{session_path}";

interface ExecError extends Error {
  code?: number | string;
  stderr?: string;
}

type ExecFileCallback = (
  error: ExecError | null,
  stdout: string,
  stderr: string,
) => void;

type ExecFileLike = (
  file: string,
  args: string[],
  callback: ExecFileCallback,
) => void;

export class TmuxUnavailableError extends Error {
  constructor(message: string = "tmux is not installed") {
    super(message);
    this.name = "TmuxUnavailableError";
  }
}

export interface EnsureTmuxSessionResult {
  action: "attached" | "created";
  session: TmuxSession;
}

export class TmuxSessionManager {
  constructor(
    private readonly runExecFile: ExecFileLike = (file, args, callback) => {
      execFile(file, args, callback as never);
    },
  ) {}

  public async discoverSessions(): Promise<TmuxSession[]> {
    try {
      const stdout = await this.runTmux([
        "list-sessions",
        "-F",
        TMUX_LIST_FORMAT,
      ]);
      return this.parseSessions(stdout);
    } catch (error) {
      if (this.isNoSessionsError(error)) {
        return [];
      }

      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async createTreeSnapshot(
    activeSessionId: string | null = null,
  ): Promise<TreeSnapshot> {
    try {
      const sessions = await this.discoverSessions();
      const resolvedActiveSessionId =
        activeSessionId ??
        sessions.find((session) => session.isActive)?.id ??
        null;

      return {
        type: "treeSnapshot",
        sessions,
        activeSessionId: resolvedActiveSessionId,
        emptyState: sessions.length === 0 ? "no-sessions" : undefined,
      };
    } catch (error) {
      if (error instanceof TmuxUnavailableError) {
        return {
          type: "treeSnapshot",
          sessions: [],
          activeSessionId: null,
          emptyState: "no-tmux",
        };
      }

      throw error;
    }
  }

  public async ensureSession(
    sessionName: string,
    workspacePath: string,
  ): Promise<EnsureTmuxSessionResult> {
    const sessions = await this.discoverSessions();
    const existingSession = sessions.find(
      (session) => session.id === sessionName || session.name === sessionName,
    );

    if (existingSession) {
      await this.attachSession(existingSession.id);
      return {
        action: "attached",
        session: {
          ...existingSession,
          isActive: true,
        },
      };
    }

    await this.createSession(sessionName, workspacePath);
    return {
      action: "created",
      session: {
        id: sessionName,
        name: sessionName,
        workspace: this.resolveWorkspaceName(workspacePath, sessionName),
        isActive: true,
      },
    };
  }

  public async attachSession(sessionName: string): Promise<void> {
    try {
      await this.runTmux(["attach-session", "-t", sessionName]);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  public async createSession(
    sessionName: string,
    workspacePath: string,
  ): Promise<void> {
    try {
      await this.runTmux([
        "new-session",
        "-d",
        "-s",
        sessionName,
        "-c",
        workspacePath,
      ]);
    } catch (error) {
      if (this.isTmuxUnavailable(error)) {
        throw new TmuxUnavailableError();
      }

      throw error;
    }
  }

  private parseSessions(stdout: string): TmuxSession[] {
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [name, attachedCount, sessionPath] = line.split("\t");
        const trimmedName = name?.trim();

        if (!trimmedName) {
          return undefined;
        }

        return {
          id: trimmedName,
          name: trimmedName,
          workspace: this.resolveWorkspaceName(sessionPath, trimmedName),
          isActive: Number(attachedCount) > 0,
        } satisfies TmuxSession;
      })
      .filter((session): session is TmuxSession => Boolean(session));
  }

  private resolveWorkspaceName(
    workspacePath: string | undefined,
    fallbackName: string,
  ): string {
    if (!workspacePath) {
      return fallbackName;
    }

    const normalizedPath = workspacePath.trim().replace(/[\\/]+$/, "");
    return basename(normalizedPath) || fallbackName;
  }

  private runTmux(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      this.runExecFile("tmux", args, (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }

        resolve(stdout.toString());
      });
    });
  }

  private isTmuxUnavailable(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const execError = error as ExecError;
    const message =
      `${execError.message} ${execError.stderr ?? ""}`.toLowerCase();
    return (
      execError.code === "ENOENT" ||
      (message.includes("tmux") && message.includes("not found"))
    );
  }

  private isNoSessionsError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const execError = error as ExecError;
    const message =
      `${execError.message} ${execError.stderr ?? ""}`.toLowerCase();
    return (
      message.includes("no server running") ||
      message.includes("failed to connect to server") ||
      message.includes("no sessions")
    );
  }
}
