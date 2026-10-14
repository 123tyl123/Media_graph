# 项目代理说明

本目录是 FRAME 媒体图谱工作台：React、TypeScript、React Flow、Zustand 与 Dexie 构成的本地优先单页应用。工作时先理解用户当前任务，再按需阅读相关文件；不要把历史实施计划或旧测量结果当成新的需求。

## 从哪里开始

- `README.md`：启动、使用方式和已知边界。
- `PROJECT_RULES.md`：图结构、持久化、媒体、性能和验证的工程约定。修改相关部分前阅读对应章节。
- `IMPLEMENTATION_PLAN.md`：最初的实施背景，不代表当前截止时间或未完成任务清单。
- `VALIDATION.md`：已有验收记录和测量条件；新的性能结论需要重新测量。
- `package.json`：实际可运行的 npm 脚本。项目使用 `package-lock.json`。

## 工作方式

1. 只打开当前任务需要的源码和文档，先核对现有行为，再做局部修改；保留用户已有改动。
2. 源码职责：`src/model.ts` 管图模型与纯计算，`src/store.ts` 管图状态和保存队列，`src/database.ts` 管 IndexedDB 与媒体资产，`src/App.tsx` 管界面交互。脚本在 `scripts/`。
3. 改动图、存储、媒体或性能路径时遵循 `PROJECT_RULES.md` 的对应不变量，并更新受影响的测试或说明。普通文档改动只检查文字、路径和命令。
4. 优先使用项目已有依赖和脚本。不要手改 `dist/`、`standalone.html`、`node_modules/`、`test-results/` 等生成物。
5. 对实际完成的工作给出相称的验证结果；区分单元测试、真实浏览器验收和性能采样，不把某一种结果写成另一种保证。

## 常用命令（PowerShell）

需要 Node.js 22.12+。在本目录运行：

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd test
npm.cmd run build
```

按任务需要运行 `node scripts/model-benchmark.mjs`。浏览器检查先运行 `npm.cmd run preview`，另开终端运行 `npm.cmd run test:e2e`；该脚本需要本机可启动 Edge。文档改动不要求重跑整套构建或浏览器检查。

## 完成标准

完成用户要求的具体改动，运行与改动范围相称的检查，修正实际发现的问题，并在交付说明中写明改了什么、验证了什么及尚未验证的相关边界。不要仅因为历史计划中还有其他功能就扩大当前任务。
