# Antigravity Web UI · 局域网智能体控制台

参考 **DeepSeek Harness (`dsh web`)** 交互理念开发，专为局域网（LAN）环境打造的 **Google Antigravity 智能体 Web 控制台**。

无需在命令行终端中盲打，只要在局域网内的任何电脑、平板或手机浏览器中打开本服务，即可在直观的 Web 界面上自由添加工作区、管理项目代码、调用底层智能体执行任务与命令。

---

## 一、 快速访问

- **端口**：`3999`（默认端口，支持通过 `PORT` 环境变量自定义）
- **访问地址**：
  - 👉 **`http://<服务器局域网IP>:3999`** （例如 `http://192.168.1.100:3999`）
  - 👉 **`http://127.0.0.1:3999`** （本地访问）
- **适用场景**：局域网内的 Windows / Mac / iPad / 手机浏览器直接打开使用。

---

## 二、 核心功能特色

### 1. 多工作区管理 (Workspace Management)
- **动态添加工作区**：在页面左侧点击「+ 添加」，输入服务器上的任意绝对路径（如 `/home/user/project` 或代码仓库目录）。
- **实时路径校验**：输入路径时自动检测目录是否存在、是否为有效目录、是否包含 Git 仓库。
- **工作区即时切换**：所有对话、代码读取、命令执行均严格限定在所选工作区的上下文中（`cwd` 自动隔离）。
- **快速常用路径**：预置了当前项目常用快捷路径。

### 2. 流式对话与智能体能力 (Streaming Agent Chat)
- **实时流式响应 (SSE)**：基于 Server-Sent Events 协议，打字机实时吐字输出。
- **深度思考抽屉 (Thinking Process)**：类似 DeepSeek 的思考过程折叠卡片，可随时展开/收起，查看模型推理链条与 Token 开销。
- **可视化工具卡片 (Tool Calls)**：当智能体执行 `run_command`（运行命令）、`replace_file_content`（修改代码）、`view_file`（读文件）时，界面以动态卡片展示执行状态（执行中/完成/失败）及详细输出。
- **富文本与代码高亮**：完整支持 Markdown 语法、表格、引用块，代码块自带语言标签与「一键复制代码」按钮。
- **全文件拖拽、粘贴与多模态支持 (Files & Images Upload)**：
  - **当前工作区自动归档**：在哪个工作区开启对话，粘贴/拖拽的文件及图片都会自动保存在该工作区目录下的 **`agyweb-uploads/`** 文件夹内。
  - **自动填入服务器绝对路径**：上传完成后，对话窗口自动输入上传文件的完整绝对路径，光标自动停在后面，无需多余说明文字包裹，方便客户直接输入后续提示词。
  - **全格式支持**：支持图片（PNG/JPG/WEBP 等）、PDF、各类代码和文档直接拖拽（支持窗口任意位置拖入释放）与上传。
  - 支持在输入框中直接 **`Ctrl+V` (或 `Cmd+V`) 粘贴系统截图或剪贴板文件**。
  - 输入框下方直接提供模型、思考深度（高/中/低）与执行模式（自动执行/仅规划）切换选择。
- **两套主题无缝切换 (Dark & Light Themes)**：
  - 顶部导航栏提供一键切换按钮（🌙 深色极客风 / ☀️ 浅色白净风），并自动持久化到本地 `localStorage`。

### 3. 多模型与运行模式自由切换
- **模型支持**：
  - `Gemini 3.8 Flash (High Reasoning)`（默认，极速且高智力）
  - `Gemini 3.8 Flash (Medium / Low)`
  - `Gemini 3.7 Flash (High)`
  - `Gemini 3.1 Pro (High Reasoning)`（架构设计与深层重构）
  - `Claude Sonnet 4.6`
  - `Claude Opus 4.6 (Thinking)`
  - `GPT-OSS 120B (Medium)`
- **模式切换**：
  - ⚡ **自动执行 (Accept Edits)**：拥有完整编码与系统操作能力。
  - 📋 **仅规划 (Plan Only)**：只做架构分析、只读排查与方案规划，不修改任何文件。
- **思考深度 (Effort)**：支持 High / Medium / Low 三档调节。

### 4. 历史会话管理
- 自动同步并显示本地所有历史会话（读取 `~/.gemini/antigravity-cli/brain/`）。
- 支持一键切换旧会话继续沟通，或点击「新建对话」开启全新上下文。

---

## 三、 运行与守护进程管理 (PM2)

本服务已集成到服务器系统的 PM2 进程守护器中，开机自启、奔溃自动拉起：

```bash
# 启动服务
bash start.sh          # 或直接 node server.js / npm start

# 停止服务
bash stop.sh

# 重启服务
bash restart.sh

# 查看运行状态与日志
pm2 status antigravity-web-ui
pm2 logs antigravity-web-ui
```

---

## 四、 架构说明

```text
antigravity-web-ui/
├── server.js              # 轻量级原生 Node.js 后端（SSE 流式转发、工作区校验、进程管理）
├── ecosystem.config.cjs   # PM2 进程管理配置
├── start.sh / stop.sh     # 运维控制脚本
├── data/
│   └── workspaces.json    # 工作区持久化配置
└── public/
    ├── index.html         # 单页面应用 (SPA) 骨架
    ├── app.css            # 现代化响应式深色主题 UI 样式
    ├── app.js             # 前端控制逻辑（SSE 流式处理、Markdown 渲染、多工作区管理）
    └── favicon.svg        # 官方矢量 Logo 图标
```

底层直接调用服务器本地官方已授权的 `/root/.local/bin/agy` CLI 二进制，无需额外配置任何 API Key，使用您绑定的 Google 官方订阅额度。
