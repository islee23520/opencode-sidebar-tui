import * as AiTool from "../ai-tool-selector";

type AiToolConfig = AiTool.AiToolConfig;

export interface TmuxDashboardSessionDto {
  id: string;
  name: string;
  workspace: string;
  isActive: boolean;
  paneCount?: number;
  preview?: string;
}

export interface TmuxDashboardPaneDto {
  paneId: string;
  index: number;
  title: string;
  isActive: boolean;
  currentCommand?: string;
  windowId?: string;
  currentPath?: string;
  paneLeft?: number;
  paneTop?: number;
  paneWidth?: number;
  paneHeight?: number;
}

export interface TmuxDashboardWindowDto {
  windowId: string;
  index: number;
  name: string;
  isActive: boolean;
  panes: TmuxDashboardPaneDto[];
}

export interface DashboardPayload {
  sessions: TmuxDashboardSessionDto[];
  nativeShells?: NativeShellDto[];
  workspace: string;
  windows?: Record<string, TmuxDashboardWindowDto[]>;
  showingAll?: boolean;
  tools?: AiToolConfig[];
}

export interface NativeShellDto {
  id: string;
  label?: string;
  state: string;
  isActive: boolean;
}

export interface HostMessage {
  type: string;
  sessions?: TmuxDashboardSessionDto[];
  workspace?: string;
  windows?: Record<string, TmuxDashboardWindowDto[]>;
  showingAll?: boolean;
  tools?: AiToolConfig[];
  sessionId?: string;
  sessionName?: string;
  defaultTool?: string;
}
