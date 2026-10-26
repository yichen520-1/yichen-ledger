# 忆尘记账 · Yichen Ledger

一个**本地优先**的个人记账应用：一套代码，同时运行在 **Android / iOS / Windows / macOS** 上。
数据全部保存在你自己的设备里（IndexedDB），不经过任何服务器。

> 当前版本 `v0.1.0`，功能可用，持续迭代中。

---

## 📦 下载安装包

所有平台的现成安装包都在这里，**不需要自己编译**：

**<https://github.com/yichen520-1/yichen-ledger/releases/latest>**

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `yichen-ledger-0.1.0-win-x64.exe` | 安装版，可选安装目录 |
| Windows | `yichen-ledger-0.1.0-win-x64.zip` | 免安装，解压即用 |
| macOS（Apple 芯片） | `yichen-ledger-0.1.0-mac-arm64.dmg` | M1/M2/M3/M4 |
| macOS（Intel） | `yichen-ledger-0.1.0-mac-x64.dmg` | 老款 Mac |
| Linux | `yichen-ledger-0.1.0-linux-x86_64.AppImage` | `chmod +x` 后直接运行 |
| Android | `app-debug.apk` | 手机浏览器下载后点安装 |
| iOS | `yichen-ledger-unsigned.ipa` | **未签名**，需自行重签，见下方说明 |

> 没有代码签名证书和 Apple 开发者账号，所以：
> Windows 首次运行会提示「未知发布者」（点「更多信息 → 仍要运行」）；
> macOS 首次打开要在「系统设置 → 隐私与安全性」里点「仍要打开」；
> iOS 的 ipa 是未签名的，用 SideStore / Sideloadly 重签后才能装。

被这些提示卡住、或者只是想先试试，**直接用上面的网页版最省事**。

---

## 🌐 直接用：网页版（最快上手）

**<https://yichen520-1.github.io/yichen-ledger/>**

不用装任何东西，手机和电脑的浏览器打开就能记账。这是一个完整的 PWA：

| 平台 | 怎么装成 App |
| --- | --- |
| iPhone / iPad | Safari 打开 → 分享按钮 → **添加到主屏幕** |
| Android | Chrome 打开 → 右上角菜单 → **安装应用** / 添加到主屏幕 |
| Windows / macOS | Chrome / Edge 地址栏右侧的**安装**图标 |

装到主屏幕后**全屏运行、没有地址栏**，图标就是应用自己的图标，用起来和原生 App 没有区别。
装过一次之后**断网也能用**（Service Worker 缓存了所有静态资源，数据本来就在本机）。

> 网页版和原生包用的是同一份代码、同一个 IndexedDB 库结构，但**数据不互通**
> （不同域名算不同的存储）。长期用建议固定一个平台，或者用「设置 → 导出备份」搬数据。

---

## 技术选型

| 层 | 选型 | 为什么 |
| --- | --- | --- |
| 界面 | React 18 + TypeScript + Vite | 生态成熟、构建快，Web 技术栈能一套代码覆盖四端 |
| 移动端 | Capacitor 7 | 把同一份 web 产物装进原生壳，能上架 App Store / 应用商店 |
| 桌面端 | Electron 33 | Windows/macOS 上开箱即用，不需要用户额外装运行环境 |
| 网页版 | PWA + GitHub Pages | 免安装、免审核，iOS 上没有 Mac 也能先用起来 |
| 数据 | IndexedDB + Dexie 4 | 离线可用、无后端、四端 API 一致 |
| 路由 | HashRouter | Electron 用 `file://`、Capacitor 用 `capacitor://localhost`，只有 hash 路由在四端行为一致 |
| 金额 | **以「分」为单位的整数** | 彻底避免 `0.1 + 0.2 !== 0.3` 这类浮点误差 |

---

## 已经实现的功能

- **记一笔**：支出 / 收入 / 转账三类；自定义键盘输入金额；分类九宫格；备注、标签、日期
- **账户**：现金、电子钱包、银行卡、信用卡、投资五类；设置初始余额；归档 / 删除保护
- **总览**：净资产、本月收支与结余、环比、账户余额、分类占比、按天分组的流水
- **统计**：月度切换、近 6 个月收支趋势柱状图、分类排行、日历热力图、支出最高的几天
- **预算**：按分类或全局设定月度上限；超支标红；支持「仅本月」和「每月重复」
- **分类管理**：内置 21 个中式场景分类，可自定义图标与颜色
- **数据**：JSON 完整备份 / 恢复、CSV 导出（Excel 能直接打开）、CSV 导入（缺的分类账户会自动建）
- **离线 & 隐私**：无网络依赖、无账号、无埋点

---

## 还能往哪些方向做（功能路线图）

如果你想让记账 App 更有「记忆点」，下面这几条是最值得做的方向，按投入产出排序：

### 1. 降低「记账摩擦」——这是记账 App 的生死线
记账失败的原因九成是「懒得记」。所以优先级最高的是让记录快到不可思议：
- [ ] **快捷模板 / 常用组合**：「早餐 12 元」一键记账，点一下完成
- [ ] **上次同分类自动带出金额与账户**（连按三次「餐饮」就自动建议 25 元）
- [ ] **桌面小组件 / 锁屏组件**（iOS Widget、Android 桌面小部件）
- [ ] **全局快捷入口**：手机下拉通知栏、电脑常驻托盘 + 全局快捷键
- [ ] **自然语言记账**：「午饭 25 支付宝」直接解析成一条记录

### 2. 让数据「说话」——从记录变成洞察
- [ ] **周期性账单**：房租、会员、话费自动生成，到期前提醒
- [ ] **月度报告**：月底生成一张可分享的「本月消费画像」图片
- [ ] **同比 / 环比对比**：和去年同期比，找出「不知不觉变贵」的项目
- [ ] **储蓄率与财务健康度**：结余率、应急金月数、负债率
- [ ] **异常支出提醒**：某分类突然暴涨时给出提示

### 3. 账户与资产视角
- [ ] **多币种**：旅行记账、汇率折算
- [ ] **信用卡账单周期**：账单日 / 还款日，免息期计算
- [ ] **投资账户**：持仓市值、收益率（这一块复杂度高，建议后置）
- [ ] **债务管理**：借入借出、人情往来记录

### 4. 协作与同步
- [ ] **多人共享账本**：家庭账本、AA 分账
- [ ] **端到端加密同步**：可选自建 WebDAV / 坚果云，或自建后端
- [ ] **数据导出为通用格式**：便于从其他记账软件迁移进来

### 5. 平台特性
- [ ] **生物识别锁**：Face ID / 指纹 / Windows Hello
- [ ] **深色 / 浅色主题切换**（当前是深色优先）
- [ ] **多语言**：至少中英双语
- [ ] **桌面端系统托盘常驻 + 开机自启**

---

## 本地运行

```bash
# 安装依赖
npm install
# 浏览器里开发（http://localhost:5173）
npm run dev

# 单元测试（24 个用例，只测纯领域层，不需要浏览器）
npm test

# 构建 web 产物到 dist/
npm run build

# 桌面端：先启动 dev server，再开 Electron
npm run dev:desktop

# 直接跑打包后的桌面版（需要先 npm run build）
npm run electron
```

### 自检脚本

仓库里带了五个用来确认「真的能跑」的脚本，CI 或本地改完代码都可以跑：

```bash
npm run build
npx vite preview --port 4173 &      # 先起一个静态服务
node scripts/smoke.mjs              # 用真实 Chrome 走一遍记账流程并截图到 .shots/
node scripts/flows.mjs              # 深流程：预算超支、建账户、改账目、建分类、持久化
node scripts/pwa-check.mjs          # 网页版：manifest、图标、SW 缓存、断网后还能打开
node scripts/live-check.mjs         # 直接打线上 Pages 地址，端到端验证线上那份能用

# 或者验证桌面端（Electron 直接加载 dist/index.html）
node_modules/electron/dist/electron.exe --no-sandbox --user-data-dir=.shots/edata scripts/electron-check.cjs
```

`scripts/smoke.mjs` 会：打开首页 → 输入金额 → 选分类 → 保存 → 回首页确认 → 遍历统计/预算/我的/账户/分类 → 桌面宽度再截一轮，任何控制台报错都会让脚本以非 0 退出。

`scripts/flows.mjs` 会：新建总预算 → 记一笔 1500 元把钱花超 → 断言进度条变红 → 新建账户 → 点首页的账目进编辑页改金额 → 新建分类 → 刷新页面确认 IndexedDB 里数据还在。

`scripts/pwa-check.mjs` 会：断言 manifest 能被解析且 display 是 standalone → 四个图标都能下载 → Service Worker 进入 `activated` → 缓存里真的有 index.html 和带 hash 的 JS → **切到离线模式后刷新，页面照样能打开**。最后一项是网页版能不能「装到主屏当 App 用」的关键。

`scripts/live-check.mjs` 不走本地，直接打开 <https://yichen520-1.github.io/yichen-ledger/>：记一笔 66.66 元、断言净资产跟着变、四个子页面都能渲染、SW 已注册、没有控制台错误。用来确认**部署上去的那一份**（而不是本地 dist）真的可用。发布之后跑一次最踏实。

### 推送代码时如果连不上 GitHub

这台机器到 GitHub 的 HTTPS 经常连不上，分两种表现：

| 表现 | 说明 |
| --- | --- |
| `Failed to connect to github.com:443` / `Connection was reset` | DNS 解析到的 IP 该端口不通 |
| `OpenSSL SSL_read: unexpected eof while reading` | TCP 和 TLS 都握手成功了，但 HTTP 请求发出去就没回音 |

第二种最迷惑人：`Test-NetConnection github.com -Port 443` 明明返回 `True`，
`git push` 却一直超时。原因是端口能建立连接不代表整条链路通。**这时换 SSH 最省事**：

```bash
# 一次性：生成密钥并把公钥加到仓库的 Deploy keys（勾选 Allow write access）
ssh-keygen -t ed25519 -f ~/.ssh/yichen_ledger -N "" -C "yichen-ledger deploy"
# 然后把 ~/.ssh/yichen_ledger.pub 的内容贴到
#   https://github.com/yichen520-1/yichen-ledger/settings/keys

# 让这个仓库走 SSH（只写进 .git/config，不会提交）
git remote set-url origin git@github.com:yichen520-1/yichen-ledger.git
git config --local core.sshCommand 'ssh -i ~/.ssh/yichen_ledger -o BatchMode=yes'
```

实测 `github.com:22` 与 `ssh.github.com:443` 都通，SSH 比 HTTPS 稳得多。

另一条路是走本地 CONNECT 代理（仓库外 `.tmp-ssh/proxy.mjs`，已被 gitignore），
把连接强制转到可用 IP：

```bash
node .tmp-ssh/proxy.mjs                                  # 另开一个终端
git -c http.proxy=http://127.0.0.1:7899 push origin main
```

还有一点：这台机器上 `git` 的 `http.sslBackend` 是 `schannel` 时会报
`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`，
需要 `git -c http.sslBackend=openssl`（或 `git config --global http.sslBackend openssl` 永久改掉）。

## 打包到各平台

### Windows / macOS（Electron）

已经接好 `electron-builder`，配置在 [electron-builder.config.cjs](electron-builder.config.cjs)：

```bash
npm run pack:win     # Windows：NSIS 安装包 + 免安装 zip
npm run pack:mac     # macOS：dmg（需在 macOS 上执行）
npm run pack:dir     # 只解包不打包，用来快速验证
```

图标由 `scripts/make-icon.py` 生成（用微软雅黑渲染「忆」字），
改图标就改这个脚本再跑一次，或用 `npm run make:icon`：

```bash
python scripts/make-icon.py
```

产物结构：`忆尘记账 Setup 0.1.0.exe`（约 87 MB，可选安装目录）、
`忆尘记账-0.1.0-win.zip`（免安装，约 111 MB）。

> **排坑：输出目录不能带中文。** NSIS 生成卸载程序时会执行一次自己产出的
> 安装包，如果**目录路径**里有中文（比如本项目就放在 `D:\Desktop\忆尘记账`），
> 这一步会直接失败并报 `process failed 2`。配置里已经做了处理：
> 检测到路径含非 ASCII 字符就自动把产物输出到系统临时目录
> （`%TEMP%\yichen-ledger-release`）。文件名带中文没问题，只有路径有影响。

> 没有代码签名证书，所以安装时 Windows SmartScreen 会提示「未知发布者」，
> 点「更多信息 → 仍要运行」即可。要消掉这个提示需要购买代码签名证书。

### Android（Capacitor）

Android 工程已经在 `android/` 目录里生成好并提交进仓库了，
换一台机器只要重装依赖就能接着用。构建需要 Android Studio（或 SDK + JDK 17+）：

```bash
npm run build
npm run cap:sync          # 把 dist/ 同步进 android/
npx cap open android      # 在 Android Studio 里运行 / 打 APK
```

如果 `android/` 目录被删了，用 `npx cap add android` 重新生成，
注意重新生成后再手动改一次 `android/app/src/main/res/values/strings.xml`
里的 `app_name`（生成器默认会写成英文名）。

> 仓库里没有 APK 产物（3.9 MB 的 debug 包不进版本库），
> 用 Android Studio 打开 `android/` 目录，等 Gradle 同步完就能直接跑真机或模拟器。

> **排坑：项目路径含中文。** AGP 遇到非 ASCII 路径会直接拒绝构建，报
> `Your project path contains non-ASCII characters`。仓库里已经在
> `android/gradle.properties` 打开 `android.overridePathCheck=true`，
> 实测能正常编译出 APK。另外 `android/build.gradle` 里加了阿里云 Maven
> 镜像放在 `google()` / `mavenCentral()` 前面 —— 国内直连 Maven Central
> 经常超时，会报 `Could not resolve org.jetbrains.kotlin:kotlin-stdlib-jdk8`。

### iOS（Capacitor）

`ios/` 工程骨架也已经生成好并提交了。构建必须在 macOS 上、装好 Xcode：

```bash
npm run build
npm run cap:sync
npx cap open ios         # 在 Xcode 里运行 / 打包
```

> Windows 上没法编译 iOS，但 Capacitor 是跨平台的，在 Windows 上照样能
> 生成 `ios/` 工程（只是会跳过 `pod install`）。到 Mac 上先跑一次
> `npx cap sync ios` 装好 Pod 依赖，再用 Xcode 打开。
>
> 上架 App Store 还需要 Apple 开发者账号（$99/年）配置签名，
> 只想自己用的话用免费个人账号装到自己的设备上就行（7 天要重签一次）。

### 让 CI 帮你出全平台安装包

在一台 Windows 机器上做不出 macOS 的 dmg，也编译不了 iOS 的 ipa。
[.github/workflows/build-installers.yml](.github/workflows/build-installers.yml)
把这一步交给 GitHub Actions —— 它三种系统的 runner 都有：

```bash
git tag v0.1.0
git push origin v0.1.0
```

推一个 `v*` 的 tag 就会并行跑五个任务，然后建一个 Release，把产物挂上去：

| 任务 | 运行环境 | 产物 |
| --- | --- | --- |
| windows | `windows-latest` | NSIS 安装包 + 免安装 zip |
| macos | `macos-latest` | dmg（arm64 + x64） |
| linux | `ubuntu-latest` | AppImage |
| android | `ubuntu-latest` + JDK 21 | `app-debug.apk` |
| ios | `macos-latest` + CocoaPods | 未签名 ipa |

也可以去 Actions 页面手动 `Run workflow`，那样只留 artifact 不建 Release。

> **产物文件名是纯 ASCII。** GitHub 会把 Release 资产名里的非 ASCII 字符
> 统统替换成 `.`（`忆尘记账 Setup 0.1.0.exe` 会变成 `Setup.0.1.0.exe`），
> 所以 `electron-builder.config.cjs` 里给三端都设了 `artifactName`，
> 统一成 `yichen-ledger-<版本>-<平台>-<架构>.<扩展名>`。
> 装好之后显示的名字、快捷方式、窗口标题仍然是「忆尘记账」，不受影响。


> **iOS 的包是未签名的。** 没有 Apple 开发者证书，`xcodebuild` 只能出
> `CODE_SIGNING_ALLOWED=NO` 的产物，iPhone 上直接装不了。拿到后用
> SideStore / Sideloadly 这类工具在本地重签，或者干脆把 `ios/App` 拖进
> Xcode 用你自己的免费账号跑一次真机。
>
> Android 用的是模板自带的 debug keystore，自用没问题，上架要换正式签名。

---

## 网页版部署（GitHub Pages）

推送到 `main` 之后 GitHub Actions 会自动构建并发布，配置在
[.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)：

**<https://yichen520-1.github.io/yichen-ledger/>**

流程是：`npm ci` → `npm test` → `npm run build` → 上传 `dist/` 到 Pages。
想手动重新发布就在 Actions 页面点一次 `Run workflow`。

因为 `vite.config.ts` 里 `base` 用的是相对路径 `'./'`，产物既能放在
`https://yichen520-1.github.io/yichen-ledger/` 这样的子路径下，也能
直接被 Electron 用 `file://` 打开，一份产物四种用法。

> PWA 的离线能力由 [public/sw.js](public/sw.js) 提供。它在 `install` 阶段
> 会去解析 `index.html`，把里面带 hash 的 `assets/*.js`、`*.css` 一起预缓存 ——
> 这一步不能省：Service Worker 是页面加载完才注册的，第一次加载的 JS
> 根本不经过它，不预缓存的话「装完马上断网」会白屏。
>
> 换了资源就要让用户拿到新版本，所以缓存名 `CACHE = 'yichen-ledger-v1'`
> 改动后要顺手升个号。Electron（`file://`）和 Capacitor（`https://localhost`）
> 里会跳过注册，靠 `window.Capacitor` 判断，避免壳里读到旧缓存。

---

## 目录结构

```
src/
  domain/model.ts        纯领域逻辑：金额、日期、汇总、CSV（无框架依赖，可单测）
  db/index.ts            Dexie 表结构与默认账户/分类
  db/repository.ts       所有增删改查、导入导出
  state/LedgerContext.tsx 用 useLiveQuery 订阅数据库，写库后全站自动刷新
  pages/                 总览 / 记一笔 / 统计 / 预算 / 我的 / 账户 / 分类
  components/Toast.tsx   轻提示
  styles.css             深色主题，移动优先，>=900px 切桌面布局
public/
  manifest.webmanifest   PWA 清单（名字、图标、快捷方式）
  sw.js                  Service Worker：离线缓存
  pwa-*.png              网页版图标
tests/domain.test.ts     领域层单元测试
electron/main.cjs        桌面端主进程
capacitor.config.ts      移动端配置
build/                   electron-builder 用的图标（由 scripts/make-icon.py 生成）
.github/workflows/       GitHub Pages 自动部署
scripts/                 自检脚本 + 图标生成
```

---

## 数据说明

- 所有金额在内存和数据库里都是「分」的整数，展示时才换算成元
- 账户余额 = 初始余额 + 收入 − 支出 ± 转账
- 净资产只统计「计入总资产且未归档」的账户
- 转账不计入收支统计，只在账户之间移动
- 备份是普通 JSON 文件，你可以直接打开查看，数据不被锁定

## 许可证

MIT
