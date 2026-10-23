// 本机开通与管理账号（不开放注册）：
//   npm run account -- add <账号名>            开所有者账号（只能有一个）
//   npm run account -- add <账号名> --partner  开伙伴账号
//   npm run account -- reset <账号名>          重置密码（这个账号已登录的地方全部退出）
//   npm run account -- list                    列出账号
// 密码随机生成，只在这里显示一次，请记下；库里只存哈希。
import { parseArgs } from 'node:util';
import { openAccounts, ROLES } from '../src/web/accounts.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { data: { type: 'string', default: 'data' }, partner: { type: 'boolean', default: false } } });
const [command, name] = positionals;
const accounts = openAccounts(values.data);
try {
  if (command === 'add' && name) {
    const role = values.partner ? 'partner' : 'owner';
    const password = accounts.create({ name, role });
    console.log(`已开通${ROLES[role]}账号 ${name}\n初始密码：${password}\n密码只显示这一次，请记下。`);
  } else if (command === 'reset' && name) {
    console.log(`已重置 ${name} 的密码，已登录的地方都已退出。\n新密码：${accounts.resetPassword(name)}\n密码只显示这一次，请记下。`);
  } else if (command === 'list') {
    const rows = accounts.list();
    console.log(rows.length ? rows.map((a) => `${a.name}\t${ROLES[a.role]}\t开通于 ${a.created_at.slice(0, 10)}`).join('\n') : '还没有账号。先运行 npm run account -- add <账号名>');
  } else {
    console.error('用法：npm run account -- add <账号名> [--partner] | reset <账号名> | list');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  accounts.close();
}
