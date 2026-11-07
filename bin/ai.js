// AI 接入自检：npm run ai -- [--data data] [--no-check]
// 打印本应用「AI 接入」的现状（#69，全局规则 P-13）：默认执行方、Codex 和 Claude 的可用状态（装没装、登没登录、最近一次调用成败）、
// 功能清单（谁做、怎么接、读什么、写到哪）、对外开放、数据对象。和设置页「AI 接入」一栏同一份数据（src/ai-access.js）。
// 默认先在本机查一次两家的可用状态并存进 data/ai-status.json（不调用模型、不花额度）；--no-check 只读已存的。
import { parseArgs } from 'node:util';
import { readSettings } from '../src/settings/index.js';
import { checkAgents } from '../src/agent.js';
import { saveChecks, aiAccess, describeAi } from '../src/ai-access.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' }, 'no-check': { type: 'boolean' } } });
if (!values['no-check']) saveChecks(values.data, await checkAgents());
const access = aiAccess(values.data, readSettings(values.data));
console.log(describeAi(access));
if (access.features.some((f) => f.problem)) process.exitCode = 1;
