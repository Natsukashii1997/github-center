// 项目资料（#6）：简介、使用条件和 Skill 列表，每天出榜后为榜单上的项目更新；网站只读存下的结果。
// 安装指令（#7）由存下的项目资料现场拼出，不调用外部接口。
export { updateProfiles } from './update.js';
export { codexGenerator } from './codex.js';
export { findProfile, readProfile, findOnBoards, currentGenerated } from './store.js';
export { parseSkill, skillPlace, skillPurpose } from './skills.js';
export { installInstruction, INSTALL_AIS } from './install.js';
