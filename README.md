# 永恒之塔 战斗数据日报（静态网站）

纯静态网站：`index.html` + `app.js` + `style.css` + `data/*.json`，无需构建、无需服务器，可免费部署到 Cloudflare Pages。

## 每天怎么用

1. 水表（AionBattleReview）跑完当天数据后，在本文件夹打开 PowerShell，运行：
   ```powershell
   .\publish-daily.ps1                  # 发布 Evidence 里最新的一天
   .\publish-daily.ps1 -Date 20261013   # 发布指定日期
   .\publish-daily.ps1 -All             # 重新发布全部日期
   .\publish-daily.ps1 -NoPush          # 只生成数据，不上传
   ```
   若提示“禁止运行脚本”，先执行一次：`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
2. 脚本会从 `C:\Users\Cassen\Documents\AionS2-Isolated-20261015-Batch25\Evidence` 读取
   `B25-PL-import-real-日期.s2-players.csv / .s2-legions.csv / .s2-skill-patterns.csv`，
   生成 `data\YYYY-MM-DD.json` 并更新 `data\index.json`。
3. 如果本文件夹是 git 仓库且配置了远程仓库，脚本会自动提交并推送；Cloudflare 1~2 分钟后自动更新网站。

Evidence 目录换了位置时，用 `-EvidenceDir "新路径"` 指定。

## 每场战斗 / 沙盘回放

脚本还会读当天的 `.s2-facts.csv` 和 `.txt` 报告里“文件:”那一行指出的解码帧（`F:\Aion-Project\PL-AionMeter-ProtocolLab\DecodedFrames\frames-*.ndjson`），
在本机推导出每一场战斗和玩家轨迹（需要 PowerShell 7，即 `pwsh`）：

- **分场规则**和水表一样：某分钟阵亡数 ≥ max(3, 全程每分钟平均阵亡 × 2) 记为“大量死亡分钟”，一场战斗 = 第一个这样的分钟前 1 分钟 → 最后一个后 1 分钟，间隔 > 5 分钟就断开成两场。
  一天里如果没有这样的分钟（比如只有零星击杀），就改按交战活动分段（空闲 > 3 分钟断开，至少 20 次命中）。
- **地图**：和水表一样用“NPC 唯一锚点”认图，每个观察端会话各自认，玩家归到其坐标来源会话的地图。
  底图取自 `Release\Maps\<地图>_full.png`，缩成 1600px 的 JPG 放在 `maps\`。
- 生成文件：`data\day\日期.js`（日汇总+战斗列表）、`data\tracks\日期-bN.js`（每场轨迹，打开沙盘时才加载）、`data\bundle.js`（日期和地图索引）。
- 选项：`-NoBattles` 只发布日汇总；`-FramesFile 路径` 手动指定帧文件；`-TrackSampleSec 3` 轨迹采样间隔。

## 公开了哪些数据

只导出：角色名、军团、阵营、职业、来源实体数、PvP/PvE 技能和普攻候选值；军团汇总；技能结构统计（去掉了观察者和会话字段）。
每场战斗只公开：开始/结束时间、时长、地图、参战人员伤害、击杀者/阵亡者名字、玩家坐标轨迹。
**不会**上传：`.s2-facts.csv`、`crossobserver` 文件、tsv 审计文件，以及 Observer / SessionHash / FullSessionId / PayloadSHA256 / ObjectId 等字段。
注意：网站公开后，任何人都能看到其他玩家的角色名、军团和伤害数据。

## 本地预览

直接双击 `index.html` 就能看（数据以 `.js` 脚本加载，file:// 也能用）。

## 第一次部署到 Cloudflare Pages（免费）

1. 在 GitHub（账号 cassen-Hu）新建一个仓库，例如 `aion-stats`（公开或私有都可以）。
2. 在本文件夹执行：
   ```powershell
   git init
   git add -A
   git commit -m "初始化"
   git branch -M main
   git remote add origin https://github.com/cassen-Hu/aion-stats.git
   git push -u origin main
   ```
3. 登录 https://dash.cloudflare.com → Workers 和 Pages → 创建 → Pages → 连接到 Git → 选择 `aion-stats` 仓库。
4. 构建设置：框架预设选“无”，**构建命令留空**，**构建输出目录填 `/`**，然后保存并部署。
5. 部署完成后得到 `https://aion-stats.pages.dev` 这样的地址。国内访问不稳时，可在 Pages 的“自定义域”里绑定自己的域名。

之后每天只需运行 `.\publish-daily.ps1`。

## 职业对照（ClassId）

1 剑星、2 守护星、4 杀星、5 弓星、7 魔道星、8 精灵星、10 治愈星、11 护法星（来自 CaoBattle 的 AionPlayerInfoParser）。阵营 Race：0 天族、1 魔族。
