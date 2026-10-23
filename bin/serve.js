// 起本机网站：npm run serve -- [--data data] [--port 5310]，只监听 127.0.0.1。
import { parseArgs } from 'node:util';
import { startServer } from '../src/web/server.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' }, port: { type: 'string', default: '5310' } } });
const { url } = await startServer({ dataDir: values.data, port: Number(values.port) });
console.log(`涨星榜：${url}`);
