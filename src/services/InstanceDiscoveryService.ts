import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { OpenCodeApiClient } from "./OpenCodeApiClient";
import { OutputChannelService } from "./OutputChannelService";

const MIN_PORT = 16384;
const MAX_PORT = 65535;
const DEFAULT_COMMAND = "opencode -c";

export interface OpenCodeInstance {
  port: number;
  pid: number;
  workspacePath?: string;
}

interface ProcessCandidate {
  pid: number;
  commandLine: string;
}

export class InstanceDiscoveryService {
  private instances: OpenCodeInstance[] = [];
  private autoSpawn: boolean;
  private disposed = false;
  private readonly inflightControllers = new Set<AbortController>();
  private readonly logger = OutputChannelService.getInstance();

  constructor() {
    const config = vscode.workspace.getConfiguration("opencodeTui");
    this.autoSpawn = config.get<boolean>("enableAutoSpawn", true);
  }

  public async discoverInstances(): Promise<OpenCodeInstance[]> {
    if (this.disposed) {
      return [];
    }

    const scanned = await this.scanProcesses();
    const healthyInstances: OpenCodeInstance[] = [];

    for (const candidate of scanned) {
      if (this.disposed) {
        return [];
      }

      try {
        const isHealthy = await this.healthCheck(candidate.port);
        if (!isHealthy) {
          continue;
        }

        const workspacePath = await this.getWorkspacePath(candidate.port);
        healthyInstances.push({
          pid: candidate.pid,
          port: candidate.port,
          workspacePath,
        });
      } catch (error) {
        this.logger.debug(
          `Health check failed for port ${candidate.port}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }

    const matchedInstances = this.filterByWorkspace(healthyInstances);
    if (matchedInstances.length > 0) {
      this.instances = matchedInstances;
      return [...this.instances];
    }

    if (this.autoSpawn) {
      const spawned = await this.spawnOpenCode();
      if (spawned) {
        this.instances = [spawned];
        return [...this.instances];
      }
    }

    this.instances = [];
    return [];
  }

  private async scanProcesses(): Promise<OpenCodeInstance[]> {
    const platform = this.getPlatform();
    const candidates =
      platform === "win32"
        ? await this.scanWindowsProcesses()
        : await this.scanUnixProcesses();

    const instances: OpenCodeInstance[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      const port = this.extractPortFromCommand(candidate.commandLine);
      if (port === undefined) {
        continue;
      }

      const key = `${candidate.pid}:${port}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      instances.push({
        pid: candidate.pid,
        port,
      });
    }

    return instances;
  }

  private async healthCheck(port: number): Promise<boolean> {
    const client = new OpenCodeApiClient(port, 1, 100, 1500);
    return client.healthCheck();
  }

  private async getWorkspacePath(port: number): Promise<string | undefined> {
    const controller = new AbortController();
    this.inflightControllers.add(controller);

    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return undefined;
      }

      const payload = (await response.json()) as {
        workspacePath?: string;
        cwd?: string;
        workspace?: string;
      };

      return payload.workspacePath ?? payload.cwd ?? payload.workspace;
    } catch (error) {
      this.logger.warn(
        `Failed to read workspace path from OpenCode health endpoint: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    } finally {
      this.inflightControllers.delete(controller);
      controller.abort();
    }
  }

  private async spawnOpenCode(): Promise<OpenCodeInstance | undefined> {
    const command = vscode.workspace
      .getConfiguration("opencodeTui")
      .get<string>("command", DEFAULT_COMMAND)
      .trim();

    if (!command) {
      return undefined;
    }

    const [file, ...args] = command.split(/\s+/);
    const port = this.generateEphemeralPort();
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    try {
      const child = execFile(file, args, {
        env: {
          ...process.env,
          _EXTENSION_OPENCODE_PORT: String(port),
          OPENCODE_CALLER: "vscode",
        },
      });

      if (!child.pid) {
        return undefined;
      }

      const processStarted = await new Promise<boolean>((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
        }, 500);

        child.on("error", () => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve(false);
          }
        });

        child.on("exit", (code) => {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            resolve(code === 0);
          }
        });
      });

      if (!processStarted) {
        return undefined;
      }

      return {
        pid: child.pid,
        port,
        workspacePath,
      };
    } catch (error) {
      this.logger.error(
        `Failed to spawn OpenCode instance: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.instances = [];

    for (const controller of this.inflightControllers) {
      controller.abort();
    }

    this.inflightControllers.clear();
  }

  private getPlatform(): NodeJS.Platform {
    return process.platform;
  }

  private async scanWindowsProcesses(): Promise<ProcessCandidate[]> {
    const stdout = await this.runCommand("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
    ]);

    if (!stdout.trim()) {
      return [];
    }

    try {
      const parsed = JSON.parse(stdout) as
        | {
            ProcessId?: number;
            Name?: string;
            CommandLine?: string;
          }
        | Array<{
            ProcessId?: number;
            Name?: string;
            CommandLine?: string;
          }>;

      const items = Array.isArray(parsed) ? parsed : [parsed];
      return items
        .map((item) => ({
          pid: item.ProcessId ?? 0,
          commandLine: `${item.Name ?? ""} ${item.CommandLine ?? ""}`.trim(),
        }))
        .filter((item) => item.pid > 0 && /opencode/i.test(item.commandLine));
    } catch (error) {
      this.logger.warn(
        `Failed to parse Windows process list for OpenCode discovery: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async scanUnixProcesses(): Promise<ProcessCandidate[]> {
    const stdout = await this.runCommand("ps", ["-ax", "-o", "pid=,command="]);

    if (!stdout.trim()) {
      return [];
    }

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (!match) {
          return undefined;
        }

        return {
          pid: Number(match[1]),
          commandLine: match[2],
        };
      })
      .filter((item): item is ProcessCandidate => Boolean(item))
      .filter((item) => /opencode/i.test(item.commandLine));
  }

  private runCommand(file: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
      execFile(file, args, (error, stdout) => {
        if (error) {
          resolve("");
          return;
        }

        resolve(stdout.toString());
      });
    });
  }

  private extractPortFromCommand(commandLine: string): number | undefined {
    const patterns = [
      /_EXTENSION_OPENCODE_PORT(?:=|\s+)(\d{2,5})/i,
      /--port(?:=|\s+)(\d{2,5})/i,
      /--http-port(?:=|\s+)(\d{2,5})/i,
      /localhost:(\d{2,5})/i,
    ];

    for (const pattern of patterns) {
      const match = commandLine.match(pattern);
      if (!match) {
        continue;
      }

      const port = Number(match[1]);
      if (this.isEphemeralPort(port)) {
        return port;
      }
    }

    return undefined;
  }

  private filterByWorkspace(instances: OpenCodeInstance[]): OpenCodeInstance[] {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      return instances;
    }

    const target = this.normalizePath(workspacePath);
    const matched = instances.filter((instance) => {
      if (!instance.workspacePath) {
        return false;
      }

      return this.normalizePath(instance.workspacePath) === target;
    });

    return matched.length > 0 ? matched : instances;
  }

  private normalizePath(pathValue: string): string {
    let normalized = pathValue.replace(/\\/g, "/");
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }

    if (this.getPlatform() === "win32") {
      return normalized.toLowerCase();
    }

    return normalized;
  }

  private generateEphemeralPort(): number {
    return Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
  }

  private isEphemeralPort(port: number): boolean {
    return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
  }
}
