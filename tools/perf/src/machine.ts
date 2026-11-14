// Machine description for result headers (no secrets: CPU model, RAM, OS only).

import os from "node:os";
import type { MachineInfo } from "./schema";

export function describeMachine(browser: string, gpu: string, adapterFlag: string): MachineInfo {
  const cpus = os.cpus();
  return {
    cpu: cpus[0]?.model.trim() ?? "unknown",
    cores: cpus.length,
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    gpu,
    browser,
    adapterFlag,
    nodeVersion: process.version,
  };
}
