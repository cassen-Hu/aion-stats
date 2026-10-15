<#
  水表数据每日发布脚本
  用法：
    .\publish-daily.ps1                 # 发布 Evidence 里最新一天
    .\publish-daily.ps1 -Date 20261013  # 发布指定日期
    .\publish-daily.ps1 -All            # 发布全部日期
    .\publish-daily.ps1 -NoPush         # 只生成 JSON，不提交/推送
  只导出白名单字段，绝不导出 facts / crossobserver / 会话标识等内容。
#>
param(
  [string]$Date,
  [switch]$All,
  [switch]$NoPush,
  [ValidateSet('s1', 's2', 's4', 's5', 's6')][string]$Server = 's1',   # 区服：s1 一区 亚特雷亚 / s2 二区 要塞盘龙 / s4 四区 命运回转 / s5 五区 荣耀再临 / s6 六区 破晓之光
  [string]$EvidenceDir = 'C:\Users\Cassen\Documents\AionS2-Isolated-20261015-Batch25\Evidence',
  [string]$Prefix = 'B25-PL-import-real-',
  [string]$ReleaseDir = 'C:\Users\Cassen\Documents\AionS2-Isolated-20261015-Batch25\Release',
  [string]$FramesFile,          # 不填则从当天 .txt 报告的“文件:”行读取
  [switch]$NoBattles,           # 跳过分场/沙盘（只发布日汇总）
  [double]$TrackSampleSec = 3,  # 沙盘轨迹采样间隔（秒）
  [string]$SkillTable = 'F:\Aion-Project\CB-CaoBattle\Program\Data\aion_skills_cn.json',   # 客户端技能表（中文名）；不用 MyAion 协议映射表
  [string]$ExtrasDir = 'F:\GB-AionLive\AionCaptureReview\Out',   # AionCaptureReview 协议补充输出（x-casts/x-buffs/x-equip/x-deaths/x-npc-target/x-revives）
  [string]$IconDds = 'C:\Users\Cassen\aion_work\dds',   # 客户端 skills.pak 解出的技能图标 DDS
  [string]$LedgerDir = 'F:\GB-AionLive\AionCaptureReview\Out\ledger'   # AionCaptureReview 统一账本输出（x-ledger-*.csv）
)
#Requires -Version 7
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Site = $PSScriptRoot
$DataDir = Join-Path $Site "data\$Server"
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory $DataDir -Force | Out-Null }
Write-Host "区服 $Server → $DataDir"
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-AvailableDates {
  Get-ChildItem $EvidenceDir -Filter "$Prefix*.s2-players.csv" |
    ForEach-Object { if ($_.Name -match '(\d{8})\.s2-players\.csv$') { $Matches[1] } } | Sort-Object -Unique
}
function L($v) { $x = 0L; if ([long]::TryParse("$v", [ref]$x)) { $x } else { 0L } }

function Publish-One([string]$d) {
  $base = Join-Path $EvidenceDir "$Prefix$d"
  $pf = "$base.s2-players.csv"; $lf = "$base.s2-legions.csv"; $sf = "$base.s2-skill-patterns.csv"
  if (-not (Test-Path $pf)) { throw "找不到 $pf" }
  # 伤害一律用统一账本（AionCaptureReview Ledger：跨观察端字节去重 + marker 0x0200/0xC200）
  $lbase = Join-Path $LedgerDir "$Prefix$d"
  $lp = "$lbase.x-ledger-players.csv"
  if (-not (Test-Path $lp)) { throw "找不到统一账本 $lp（先在 AionCaptureReview 出表，或 --ledger 生成）" }
  $ledger = @{}; Import-Csv $lp -Encoding UTF8 | ForEach-Object { $ledger[(L $_.PersonIndex)] = $_ }
  # 白名单字段（玩家）
  $players = @(Import-Csv $pf -Encoding UTF8 | ForEach-Object { $g = $ledger[(L $_.PersonIndex)]
    [ordered]@{ id = (L $_.PersonIndex); name = $_.Name; legion = $_.Legion; race = (L $_.Race); classId = (L $_.ClassId)
      sources = (L $_.SourceEntities); pvpSkill = (L $g.PvP技能); pvpAuto = (L $g.PvP普攻)
      pveSkill = (L $g.PvE技能); pveAuto = (L $g.PvE普攻) } })
  # 账本里有伤害、但 B25 玩家表里没有的人，也补进来（否则日合计会比账本少）
  $known = @{}; $players | ForEach-Object { $known[$_.id] = 1 }
  foreach ($k in $ledger.Keys) { if ($known.ContainsKey($k)) { continue }; $g = $ledger[$k]
    $players += [ordered]@{ id = $k; name = $g.名字; legion = ''; race = $(if ($g.阵营 -eq '天') { 0 } elseif ($g.阵营 -eq '魔') { 1 } else { -1 }); classId = 0
      sources = 0; pvpSkill = (L $g.PvP技能); pvpAuto = (L $g.PvP普攻); pveSkill = (L $g.PvE技能); pveAuto = (L $g.PvE普攻) } }
  # 军团 = 同军团同阵营玩家（新口径）求和；人数 = 有伤害的成员
  # 阵营主来源：服务端 0x0020 PlayerInfo race@37（0=天族 1=魔族），全天抓包扫出的 tools\packet-race.tsv；没有该包的玩家才沿用名单
  # 严格当天：阵营只取当天抓包 0x0020@37（tools\build-day-race.js → tools\day-race.tsv），没有包的玩家阵营＝未知(-1)，不跨日、不用名单、不推断
  $frames = $FramesFile
  if (-not $frames -and (Test-Path "$base.txt")) { $m = Get-Content "$base.txt" -Encoding UTF8 -TotalCount 5 | Select-String '文件:\s*(.+\.ndjson)'; if ($m) { $frames = $m.Matches[0].Groups[1].Value.Trim() } }
  $drf = Join-Path $Site 'tools\day-race.tsv'
  & node (Join-Path $Site 'tools\build-day-race.js') $drf $frames | ForEach-Object { Write-Host "  $_" }
  $pr = @{}; foreach ($l in [IO.File]::ReadAllLines($drf, $Utf8)) { $q = $l.Split("`t"); if ($q.Length -eq 2) { $pr[$q[0]] = [long]$q[1] } }
  foreach ($p in $players) { $p.race = if ($pr.ContainsKey($p.name)) { $pr[$p.name] } else { -1 } }
  # 同阵营不能互相攻击：账本命中里攻击者与目标同阵营的（切磋/错误）从 PvP 里扣掉，不计入任何伤害
  $hp = "$lbase.x-ledger-hits.csv"; $rid = @{}; foreach ($p in $players) { if ($p.race -in 0, 1) { $rid[[long]$p.id] = $p.race } }; $byId = @{}; foreach ($p in $players) { $byId[[long]$p.id] = $p }
  $sfTot = 0L; $pvpBefore = [long]($players | ForEach-Object { $_.pvpSkill + $_.pvpAuto } | Measure-Object -Sum).Sum
  if (Test-Path $hp) { foreach ($l in [IO.File]::ReadLines($hp) | Select-Object -Skip 1) { $q = $l.Split(','); if ($q.Length -lt 7 -or $q[6] -ne '1') { continue }
      $a = [long]$q[1]; $t = [long]$q[2]; if ($a -eq $t -or -not $rid.ContainsKey($a) -or -not $rid.ContainsKey($t) -or $rid[$a] -ne $rid[$t]) { continue }
      $m = [long]$q[4]; $sfTot += $m; $pp = $byId[$a]; if ($q[5] -eq '1') { $pp.pvpAuto -= $m } else { $pp.pvpSkill -= $m } } }
  foreach ($p in $players) { if ($p.pvpAuto -lt 0) { $p.pvpAuto = 0 }; if ($p.pvpSkill -lt 0) { $p.pvpSkill = 0 } }
  $pvpAfter = [long]($players | ForEach-Object { $_.pvpSkill + $_.pvpAuto } | Measure-Object -Sum).Sum
  Write-Host "PVPFIX $d PvP 合计 $pvpBefore → $pvpAfter（同阵营排除 $sfTot）"
  $legions = @($players | Where-Object { $_.legion } | Group-Object { "$($_.legion)|$($_.race)" } | ForEach-Object {
    $m = $_.Group; $dm = @($m | Where-Object { $_.pvpSkill + $_.pvpAuto + $_.pveSkill + $_.pveAuto -gt 0 })
    [ordered]@{ legion = $m[0].legion; race = $m[0].race; members = $dm.Count
      pvpSkill = [long]($m | ForEach-Object { $_.pvpSkill } | Measure-Object -Sum).Sum; pvpAuto = [long]($m | ForEach-Object { $_.pvpAuto } | Measure-Object -Sum).Sum
      pveSkill = [long]($m | ForEach-Object { $_.pveSkill } | Measure-Object -Sum).Sum; pveAuto = [long]($m | ForEach-Object { $_.pveAuto } | Measure-Object -Sum).Sum } } | Where-Object { $_.members -gt 0 })
  # 技能结构统计：去掉 FirstObserver / FirstSessionHash / FirstFrameIndex / FirstRecordIndex
  $skills = @()
  if (Test-Path $sf) { $skills = @(Import-Csv $sf -Encoding UTF8 | ForEach-Object {
    [ordered]@{ factClass = $_.FactClass; recordLength = (L $_.RecordLength); marker = $_.MarkerHex; status = $_.StatusHex
      records = (L $_.Records); positiveSum = (L $_.PositiveAmountSum); negativeSum = (L $_.SignedNegativeMagnitude) } }) }

  $iso = "{0}-{1}-{2}" -f $d.Substring(0,4), $d.Substring(4,2), $d.Substring(6,2)
  $obj = [ordered]@{ date = $iso; generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    players = $players; legions = $legions; skillPatterns = $skills }
  $json = ConvertTo-Json $obj -Depth 5 -Compress
  [IO.File]::WriteAllText((Join-Path $DataDir "$iso.json"), $json, $Utf8)
  Write-Host "已生成 data/$iso.json  玩家 $($players.Count)  军团 $($legions.Count)  技能结构 $($skills.Count)"
  if (-not $NoBattles) { Publish-Battles $d $iso $base "$lbase.x-ledger-hits.csv" }
}

# 每场战斗 + 沙盘轨迹：facts.csv 与解码帧只在本机读取，输出只含白名单聚合（见 tools\BattleExtract.cs）
function Publish-Battles([string]$d, [string]$iso, [string]$base, [string]$hitsPath) {
  if (-not (Test-Path $hitsPath)) { throw "找不到统一账本命中列表 $hitsPath" }
  $facts = "$base.s2-facts.csv"
  if (-not (Test-Path $facts)) { Write-Warning "没有 $facts，跳过分场"; return }
  $frames = $FramesFile
  if (-not $frames -and (Test-Path "$base.txt")) {
    $m = Get-Content "$base.txt" -Encoding UTF8 -TotalCount 5 | Select-String '文件:\s*(.+\.ndjson)'
    if ($m) { $frames = $m.Matches[0].Groups[1].Value.Trim() }
  }
  if (-not $frames -or -not (Test-Path $frames)) { Write-Warning "找不到解码帧文件（$frames），沙盘将没有坐标"; $frames = '' }
  if (-not ('AionBattleExtract' -as [type])) { Add-Type -Path (Join-Path $Site 'tools\BattleExtract.cs') }
  Get-ChildItem (Join-Path $DataDir 'tracks') -Filter "$iso-b*.js" -ErrorAction SilentlyContinue | Remove-Item
  Get-ChildItem (Join-Path $DataDir 'prof') -Filter "$iso.js" -ErrorAction SilentlyContinue | Remove-Item
  if (Test-Path (Join-Path $DataDir "sk\$iso")) { Remove-Item (Join-Path $DataDir "sk\$iso") -Recurse -Force }
  # 阵营表 tools\day-race.tsv 已在 Publish-One 里由当天抓包生成（严格当天）
  $log = [AionBattleExtract]::Run($facts, @($frames | Where-Object { $_ }), (Join-Path $ReleaseDir 'npc-map-anchors.tsv'),
    (Join-Path $ReleaseDir 'mapbounds.tsv'), $DataDir, $iso, $TrackSampleSec, $hitsPath)
  $xb = "$base."; if (-not (Test-Path "$($xb)x-casts-0021.csv")) { $xb = Join-Path $ExtrasDir (Split-Path "$base." -Leaf) }
  & node (Join-Path $Site 'tools\build-pextra.js') $DataDir $iso $xb $facts $SkillTable | ForEach-Object { Write-Host "  $_" }
  $log -split "`n" | Where-Object { $_ -notmatch '^MAPS:' } | ForEach-Object { Write-Host "  $_" }
  if ($log -match 'SKIP_DAY:') {
    Write-Host "  跳过 $iso：没有参战人数 > 50 的战斗，不发布这一天。"
    foreach ($x in @("$iso.json","$iso.battles.json",(Join-Path 'day' "$iso.js"))) {
      $fp = Join-Path $DataDir $x; if (Test-Path $fp) { Remove-Item $fp -Force }
    }
    $script:SkippedDays += $iso
    return
  }
  $script:MapsUsed += @(($log -split "`n" | Where-Object { $_ -match '^MAPS:' }) -replace '^MAPS:', '' -split ',' | Where-Object { $_ })
}
$script:SkippedDays = @()
$script:MapsUsed = @()
# 技能表：中文名 + 回蓝类技能（精神力/魔力/精气，治疗统计里排除）
$script:SkillNames = @{}
if (Test-Path $SkillTable) {
  foreach ($e in ([IO.File]::ReadAllText($SkillTable) | ConvertFrom-Json)) { if ($e.ChineseName) { $script:SkillNames[[int]$e.SkillId] = $e.ChineseName } }
  $mp = @($script:SkillNames.GetEnumerator() | Where-Object { $_.Value -match '精神力|魔力|精气' } | ForEach-Object { $_.Key })
  [IO.File]::WriteAllLines((Join-Path $Site 'tools\mp-skills.txt'), [string[]]$mp)
} else { Write-Warning "找不到技能表 $SkillTable，技能名与回蓝过滤不可用" }
# AOE 技能：skill_templates.xml 里 target_type="AREA"（与 Batch25 SkillData 的 AOE 判定相同，不用 MyAion 协议映射兜底）
$SkillXml = 'F:\Aion-Project\CB-CaoBattle\Program\StaticData\Data\skill_templates.xml'
if (Test-Path $SkillXml) {
  $aoeIds = [regex]::Matches([IO.File]::ReadAllText($SkillXml), '<skill_template[^>]*?skill_id="(\d+)"[^>]*>\s*<properties[^>]*target_type="AREA"') | ForEach-Object { $_.Groups[1].Value }
  [IO.File]::WriteAllLines((Join-Path $Site 'tools\aoe-skills.txt'), [string[]]$aoeIds)
}

$targets = if ($All) { Get-AvailableDates } elseif ($Date) { ,($Date -replace '-', '') } else { ,(Get-AvailableDates | Select-Object -Last 1) }
if (-not $targets) { throw "Evidence 目录里没有可用数据：$EvidenceDir" }
foreach ($t in $targets) { Publish-One $t }

# 更新 data/index.json（按日期倒序）
$dates = @(Get-ChildItem $DataDir -Filter '????-??-??.json' | ForEach-Object { $_.BaseName } | Sort-Object -Descending)
$idx = [ordered]@{ updatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'); dates = $dates }
[IO.File]::WriteAllText((Join-Path $DataDir 'index.json'), (ConvertTo-Json $idx -Depth 3), $Utf8)
Write-Host "data/index.json 已更新：$($dates -join ', ')"

# 地图底图：把用到的地图（含分层 xxx_1/_2）缩成 1600px JPG 放到 maps\，并写 data/maps.js
$mapsDir = Join-Path $Site 'maps'; if (-not (Test-Path $mapsDir)) { New-Item -ItemType Directory $mapsDir | Out-Null }
$mapInfo = [ordered]@{}
$boundsTbl = @{}; Get-Content (Join-Path $ReleaseDir 'mapbounds.tsv') -ErrorAction SilentlyContinue | Where-Object { $_ -and $_[0] -ne '#' } | ForEach-Object { $f = $_ -split "`t"; $boundsTbl[$f[0].ToLower()] = @([double]$f[1], [double]$f[2], [double]$f[3], [double]$f[4]) }
$nameTbl = @{}; Get-Content (Join-Path $ReleaseDir 'mapnames.tsv') -Encoding UTF8 -ErrorAction SilentlyContinue | Where-Object { $_ -and $_[0] -ne '#' } | ForEach-Object { $f = $_ -split "`t"; if ($f.Count -ge 2) { $nameTbl[$f[0].ToLower()] = $f[1] } }
# 保留以前已生成过的地图
$prevMaps = Join-Path $DataDir 'maps.json'
if (Test-Path $prevMaps) { (Get-Content $prevMaps -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable).GetEnumerator() | ForEach-Object { $mapInfo[$_.Key] = $_.Value } }
Add-Type -AssemblyName System.Drawing
foreach ($m in ($script:MapsUsed | Sort-Object -Unique)) {
  $src = Get-ChildItem (Join-Path $ReleaseDir 'Maps') -Filter '*_full.png' -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -match "^$([regex]::Escape($m))(_\d+)?_full$" } | Sort-Object Name
  $layers = @()
  foreach ($f in $src) {
    $lname = $f.BaseName -replace '_full$', ''; $out = Join-Path $mapsDir "$lname.jpg"; $layers += $lname
    if (Test-Path $out) { continue }
    $img = [System.Drawing.Image]::FromFile($f.FullName)
    try {
      $w = [Math]::Min(1600, $img.Width); $h = [int]($img.Height * $w / $img.Width)
      $bmp = New-Object System.Drawing.Bitmap $w, $h; $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()
      $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
      $ep = New-Object System.Drawing.Imaging.EncoderParameters 1; $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 82L
      $bmp.Save($out, $codec, $ep); $bmp.Dispose()
      Write-Host "  底图 maps/$lname.jpg"
    } finally { $img.Dispose() }
  }
  $mapInfo[$m] = [ordered]@{ name = ($nameTbl[$m] ?? $m); bounds = $boundsTbl[$m]; layers = $layers }
}
[IO.File]::WriteAllText($prevMaps, (ConvertTo-Json $mapInfo -Depth 5), $Utf8)

# 技能图标（只转网站数据里出现过的技能；已有的跳过）
if (Test-Path $IconDds) { & node (Join-Path $Site 'tools\build-icons.js') $Site $SkillTable $IconDds | ForEach-Object { Write-Host $_ } }

# 每天一个数据脚本 data/day/YYYY-MM-DD.js（日汇总 + 战斗列表），bundle.js 只放索引和地图表，
# 这样双击 index.html（file://）也能用 <script> 按需加载，不必一次装入所有日期。
$dayDir = Join-Path $DataDir 'day'; if (-not (Test-Path $dayDir)) { New-Item -ItemType Directory $dayDir | Out-Null }
foreach ($dd in $dates) {
  $daily = [IO.File]::ReadAllText((Join-Path $DataDir "$dd.json"), $Utf8)
  $bf = Join-Path $DataDir "$dd.battles.json"
  $bat = if (Test-Path $bf) { [IO.File]::ReadAllText($bf, $Utf8) } else { '[]' }
  [IO.File]::WriteAllText((Join-Path $dayDir "$dd.js"), "(window.AION_DAYS=window.AION_DAYS||{})[`"$dd`"]={`"daily`":$daily,`"battles`":$bat};", $Utf8)
}

# 玩家跨日索引 data/players.js（名字+阵营 → 出现的日期与当天编号），资料卡打开时才加载
$pidx = @{}
foreach ($dd in $dates) {
  $dj = [IO.File]::ReadAllText((Join-Path $DataDir "$dd.json"), $Utf8) | ConvertFrom-Json
  foreach ($p in $dj.players) { $k = "$($p.name)|$($p.race)"; if (-not $pidx.ContainsKey($k)) { $pidx[$k] = [System.Collections.ArrayList]::new() }; [void]$pidx[$k].Add(@($dd, $p.id, ($p.pvpSkill + $p.pvpAuto), ($p.pveSkill + $p.pveAuto))) }
}
[IO.File]::WriteAllText((Join-Path $DataDir 'players.js'), 'window.AION_PLAYERS=' + (ConvertTo-Json $pidx -Depth 4 -Compress) + ';', $Utf8)
Write-Host "data/players.js 已更新：$($pidx.Count) 个角色"

# data/skillnames.js：只收录已发布数据里出现过的技能 ID（资料卡按需加载）
if ($script:SkillNames.Count) {
  $seen = @{}; Get-ChildItem (Join-Path $DataDir 'sk') -Recurse -Filter *.js -ErrorAction SilentlyContinue | ForEach-Object {
    foreach ($m in [regex]::Matches([IO.File]::ReadAllText($_.FullName), '(?<=[\[,])\[(\d+),')) { $seen[[int]$m.Groups[1].Value] = 1 } }
  $sn = [ordered]@{}; $miss = @()
  foreach ($k in ($seen.Keys | Where-Object { $_ -ne 0 } | Sort-Object)) { if ($script:SkillNames.ContainsKey($k)) { $sn["$k"] = $script:SkillNames[$k] } else { $miss += $k } }
  [IO.File]::WriteAllText((Join-Path $DataDir 'skillnames.js'), 'window.AION_SKILLNAMES=' + (ConvertTo-Json $sn -Compress) + ';', $Utf8)
  Write-Host ("data/skillnames.js 已更新：$($sn.Count) 个技能有中文名" + $(if ($miss) { "，缺名：$($miss -join ',')" } else { '' }))
}

# 生成 data/bundle.js（双击 index.html 用 file:// 打开时浏览器禁止 fetch，所以把数据打包成脚本）
$bundle = 'window.AION_DATA={"index":' + (ConvertTo-Json @($dates) -Compress) + ',"maps":' + (ConvertTo-Json $mapInfo -Depth 5 -Compress) + '};'
[IO.File]::WriteAllText((Join-Path $DataDir 'bundle.js'), $bundle, $Utf8)
Write-Host "data/bundle.js 已更新"

if ($NoPush) { return }
$mg = Join-Path $env:LOCALAPPDATA 'MinGit\cmd'; if (-not (Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path "$mg\git.exe")) { $env:Path += ";$mg" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host '未安装 git，跳过上传。'; return }
Push-Location $Site
try {
  git rev-parse --is-inside-work-tree 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host '当前文件夹还不是 git 仓库，跳过上传（见 README）。'; return }
  git add -A
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { Write-Host '没有变化，无需提交。' }
  else { git commit -m "数据更新 $($targets -join ',')" | Out-Null; Write-Host '已提交。' }
  $remote = git remote
  if (-not $remote) { Write-Host '没有配置远程仓库，跳过推送。'; return }
  git push; if ($LASTEXITCODE -eq 0) { Write-Host '已推送，Cloudflare Pages 会在 1~2 分钟内自动更新。' } else { Write-Warning '推送失败，请检查网络或登录状态。' }
} finally { Pop-Location }
