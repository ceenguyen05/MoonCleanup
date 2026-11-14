export { Bot, createBotMetrics, SPIKE_JOIN_PATH, type BotMetrics, type BotOptions } from "./clients/bot";
export { LEAD_TICKS, steer, targetGap, type SteerInput, type SteerResult } from "./clients/steering";
export { buildReport, parseServerLog, renderMarkdown, summarizeBots, type BotReport } from "./reports/report";
export { runSpike16, isLocalUrl, type Spike16Options } from "./scenarios/spike16";
