import type * as pty from "node-pty";
import type { CliState, CliToolType } from "../../types";

export type CliEnvironment = Record<string, string>;
export interface CliConfig {
  instanceId: string;
  toolId: CliToolType;
  command: string;
  args?: string[];
  env?: CliEnvironment;
  workingDir?: string;
  preferredPort?: number;
  cols?: number;
  rows?: number;
}

export interface CliInstance {
  id: string;
  toolId: CliToolType;
  process: pty.IPty;
  state: CliState;
  port?: number;
}

export interface CliAdapterEvents {
  onData: (instanceId: string, data: string) => void;
  onExit: (instanceId: string, code: number) => void;
  onError: (instanceId: string, error: Error) => void;
  onReady: (instanceId: string) => void;
}
