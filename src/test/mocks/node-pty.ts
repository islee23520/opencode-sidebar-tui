import { vi } from "vitest";

export interface MockPtyProcess {
  pid: number;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitCode: number, signal?: number) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
  pause: () => void;
  resume: () => void;
  _dataCallbacks: Array<(data: string) => void>;
  _exitCallbacks: Array<(exitCode: number, signal?: number) => void>;
  _simulateData: (data: string) => void;
  _simulateExit: (exitCode: number, signal?: number) => void;
}

export function createMockPtyProcess(): MockPtyProcess {
  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(exitCode: number, signal?: number) => void> = [];

  const mockProcess: MockPtyProcess = {
    pid: 12345,
    onData: vi.fn((callback: (data: string) => void) => {
      dataCallbacks.push(callback);
    }),
    onExit: vi.fn((callback: (exitCode: number, signal?: number) => void) => {
      exitCallbacks.push(callback);
    }),
    write: vi.fn((data: string) => {
      mockProcess._dataCallbacks.forEach((cb) => cb(data));
    }),
    resize: vi.fn((cols: number, rows: number) => {}),
    kill: vi.fn((signal?: string) => {
      mockProcess._exitCallbacks.forEach((cb) => cb(0, undefined));
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    _dataCallbacks: dataCallbacks,
    _exitCallbacks: exitCallbacks,
    _simulateData: (data: string) => {
      dataCallbacks.forEach((cb) => cb(data));
    },
    _simulateExit: (exitCode: number, signal?: number) => {
      exitCallbacks.forEach((cb) => cb(exitCode, signal));
    },
  };

  return mockProcess;
}

export const spawn = vi.fn((file: string, args: string[], options: any) => {
  return createMockPtyProcess();
});

export default {
  spawn,
  createMockPtyProcess,
};
