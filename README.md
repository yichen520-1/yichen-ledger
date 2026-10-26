# 忆尘记账 · Yichen Ledger

一个**本地优先**的个人记账应用：一套代码，同时运行在 **Android / iOS / Windows / macOS** 上。
数据全部保存在你自己的设备里（IndexedDB），不经过任何服务器。

> 当前版本 `v0.1.0`，功能可用，持续迭代中。

---

## 技术选型

| 层 | 选型 | 为什么 |
| --- | --- | --- |
| 界面 | React 18 + TypeScript + Vite | 生态成熟、构建快，Web 技术栈能一套代码覆盖四端 |
| 移动端 | Capacitor 7 | 把同一份 web 产物装进原生壳，能上架 App Store / 应用商店 |
| 桌面端 | Electron 33 | Windows/macOS 上开箱即用，不需要用户额外装运行环境 |
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

仓库里带了三个用来确认「真的能跑」的脚本，CI 或本地改完代码都可以跑：

```bash
npm run build
npx vite preview --port 4173 &      # 先起一个静态服务
node scripts/smoke.mjs              # 用真实 Chrome 走一遍记账流程并截图到 .shots/
node scripts/flows.mjs              # 深流程：预算超支、建账户、改账目、建分类、持久化

# 或者验证桌面端（Electron 直接加载 dist/index.html）
node_modules/electron/dist/electron.exe --no-sandbox --user-data-dir=.shots/edata scripts/electron-check.cjs
```

`scripts/smoke.mjs` 会：打开首页 → 输入金额 → 选分类 → 保存 → 回首页确认 → 遍历统计/预算/我的/账户/分类 → 桌面宽度再截一轮，任何控制台报错都会让脚本以非 0 退出。

`scripts/flows.mjs` 会：新建总预算 → 记一笔 1500 元把钱花超 → 断言进度条变红 → 新建账户 → 点首页的账目进编辑页改金额 → 新建分类 → 刷新页面确认 IndexedDB 里数据还在。

## 打包到各平台

### Windows / macOS（Electron）

```bash
npm run build
npx electron-builder --win   # Windows
npx electron-builder --mac   # macOS（需在 macOS 上执行）
```

> 仓库里还没有 `electron-builder` 依赖和 `build` 配置，第一次打包前需要
> `npm i -D electron-builder` 并在 package.json 里补 `build.files` / `build.appId`。
> 这一步留给你按发布渠道（安装包 or 免安装 zip）自己定。

### Android（Capacitor）

需要先装好 Android Studio + JDK 17+：

```bash
npm run build
npx cap add android      # 第一次
npm run cap:sync
npx cap open android     # 在 Android Studio 里运行 / 打包
```

### iOS（Capacitor）

需要在 macOS 上、装好 Xcode：

```bash
npm run build
npx cap add ios          # 第一次
npm run cap:sync
npx cap open ios         # 在 Xcode 里运行 / 打包
```

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
tests/domain.test.ts     领域层单元测试
electron/main.cjs        桌面端主进程
capacitor.config.ts      移动端配置
scripts/                 自检脚本（浏览器冒烟 + Electron 加载验证）
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
