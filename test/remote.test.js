// #46 放到服务器上：Mac 拉服务器的设置和精选标签、推数据；ssh 和 rsync 用替身，只看发了什么命令、收到输出后本机怎么变。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { openAccounts } from '../src/web/accounts.js';
import { openPicks, updatePicks, DEFAULT_TAGS } from '../src/boards/index.js';
import { readRemote, pullSettings, pullPicks, writePool, pushData, PUSH_EXCLUDE, POOL_FILE } from '../src/remote/index.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'gc-remote-'));
const CFG = { ssh: 'root@1.2.3.4', key: '/k/id', dir: '/srv/tidings' };
// 替身：记下每次调用，按 ssh 的子命令或 rsync 回固定输出。
function fakeRun(replies) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const sub = cmd.endsWith('rsync') ? 'rsync' : args.at(-1).split(' ').at(-1);
    return replies[sub] ?? { status: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}
const ok = (stdout) => ({ status: 0, stdout, stderr: '' });

test('没有 data/remote.json 就是只在本机跑；有就读出来，私钥路径里的 ~ 换成家目录，缺 ssh 或 dir 报错', () => {
  const dataDir = fresh();
  assert.equal(readRemote(dataDir), null);
  writeFileSync(join(dataDir, 'remote.json'), JSON.stringify({ ssh: 'root@1.2.3.4', key: '~/.ssh/k', dir: '/srv/tidings' }));
  assert.deepEqual(readRemote(dataDir), { ssh: 'root@1.2.3.4', key: join(homedir(), '.ssh/k'), dir: '/srv/tidings' });
  writeFileSync(join(dataDir, 'remote.json'), JSON.stringify({ ssh: 'root@1.2.3.4' }));
  assert.throws(() => readRemote(dataDir), /要有 ssh 和 dir/);
});

test('拉设置：服务器存过就覆盖本机这份；没存过不动本机的；连不上报错带服务器的原话', () => {
  const dataDir = fresh();
  writeFileSync(join(dataDir, 'settings.json'), '{"daily":{"at":"10:00"}}');
  assert.equal(pullSettings(dataDir, CFG, fakeRun({ settings: ok('') }).run), false);
  assert.equal(readFileSync(join(dataDir, 'settings.json'), 'utf8'), '{"daily":{"at":"10:00"}}');
  const f = fakeRun({ settings: ok('{"daily":{"at":"11:30"}}\n') });
  assert.equal(pullSettings(dataDir, CFG, f.run), true);
  assert.equal(readFileSync(join(dataDir, 'settings.json'), 'utf8'), '{"daily":{"at":"11:30"}}\n');
  assert.deepEqual(f.calls[0], ['/usr/bin/ssh', '-i', '/k/id', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'root@1.2.3.4', 'bash /srv/tidings/scripts/server.sh settings']);
  assert.throws(() => pullSettings(dataDir, CFG, fakeRun({ settings: { status: 255, stdout: '', stderr: 'Connection timed out' } }).run), /settings 失败（退出码 255）：Connection timed out/);
});

test('推数据：rsync 只增改、不推运行记录、日志、库和设置，推完让服务器写候选池；rsync 失败就不调服务器', () => {
  const f = fakeRun({ apply: ok('候选池写入 3 个\n') });
  assert.equal(pushData('data', CFG, f.run), '候选池写入 3 个');
  const [rsync, apply] = f.calls;
  assert.equal(rsync[0], '/usr/bin/rsync');
  assert.ok(!rsync.includes('--delete'));
  for (const p of ['runs/', 'logs/', 'center.db', 'center.db-*', 'settings.json', 'remote.json']) assert.ok(rsync.includes(`--exclude=${p}`), p);
  assert.equal(PUSH_EXCLUDE.length, rsync.filter((a) => a.startsWith('--exclude=')).length);
  assert.deepEqual(rsync.slice(-2), ['data/', 'root@1.2.3.4:/srv/tidings/data/']);
  assert.match(apply.at(-1), /server\.sh apply$/);
  const bad = fakeRun({ rsync: { status: 12, stdout: '', stderr: 'connection unexpectedly closed' } });
  assert.throws(() => pushData('data', CFG, bad.run), /rsync 失败（退出码 12）/);
  assert.equal(bad.calls.length, 1);
});

// 同一份榜单数据：12 个历史榜项目，按名字给标签。
function seed(dataDir) {
  mkdirSync(join(dataDir, 'snapshots/history'), { recursive: true });
  writeFileSync(join(dataDir, 'snapshots/history/2026-11-02.json'), JSON.stringify({ statDay: '2026-11-02', entries: Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, repo: `h/p${i + 1}`, id: i + 1, ownerId: 100 + i, total: 120_000 - i * 1000, description: `d${i + 1}`, topics: [] })) }));
  return dataDir;
}
const [AGENT, SKILL] = DEFAULT_TAGS.map((t) => t.name);
const tagger = { version: 'fake-1', suggest: async (tags, items) => items.map((x, i) => ({ i, tags: Number(x.fullName.slice(3)) % 2 ? [AGENT] : [SKILL, '新标签'].filter((t) => tags.some((g) => g.name === t)) })) };
const layout = (dataDir) => {
  const picks = openPicks(dataDir);
  try {
    return picks.board(null).tags.map((t) => [t.name, t.cards.map((c) => [c.slot, c.fullName, c.pinned])]);
  } finally {
    picks.close();
  }
};

test('精选榜：Mac 拉服务器的标签清单和固定的卡，算完推候选池，服务器补出的卡和 Mac 算的一样，网页上的投票和换卡都还在', async () => {
  // 服务器：已经跑过一次；所有者加了个标签、换了一张卡，伙伴投了票。
  const srv = seed(fresh());
  const accounts = openAccounts(srv);
  accounts.create({ name: 'boss', role: 'owner' });
  accounts.create({ name: 'pal', role: 'partner' });
  const [owner, pal] = ['boss', 'pal'].map((n) => accounts.find(n));
  accounts.close();
  await updatePicks({ dataDir: srv, tagger });
  let picks = openPicks(srv);
  const added = picks.addTag(owner, { name: '新标签', color: '#123456', note: '测试' });
  const agent = picks.tags().find((t) => t.name === AGENT).id;
  picks.swap(owner, { tagId: agent, slot: 1, project: { id: 999, fullName: 'x/pinned', total: 5 } });
  picks.vote(pal, { tagId: agent, projectId: 999, value: 1 });
  const state = JSON.stringify(picks.state());
  picks.close();

  // Mac：库还是旧的（默认标签、没换过卡）。
  const mac = seed(fresh());
  await updatePicks({ dataDir: mac, tagger });
  assert.deepEqual(pullPicks(mac, CFG, fakeRun({ 'picks-state': ok(state) }).run), { tags: DEFAULT_TAGS.length + 1, pinned: 1 });
  const r = await updatePicks({ dataDir: mac, tagger });
  assert.equal(r.todo, 12, '标签清单变了，全部重新建议');
  assert.equal(writePool(mac), 12);

  // 服务器收到候选池文件后写库、补卡（bin/picks.js --apply 做的事）。
  picks = openPicks(srv);
  picks.importPool(JSON.parse(readFileSync(join(mac, POOL_FILE), 'utf8')));
  picks.refill();
  const card = picks.board(pal).tags.find((t) => t.id === agent).cards.find((c) => c.projectId === 999);
  assert.deepEqual([card.slot, card.pinned, card.up, card.mine, card.total], [1, true, 1, 1, 5], '换上的卡、投票、换卡带进来的项目都还在');
  assert.ok(picks.board(null).tags.find((t) => t.id === added).cards.length > 0, '新标签按 Mac 的建议补上了卡');
  picks.close();
  assert.deepEqual(layout(srv), layout(mac));
  assert.ok(existsSync(join(mac, POOL_FILE)));
});
