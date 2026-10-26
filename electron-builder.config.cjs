/**
 * electron-builder 配置。
 *
 * 单独放这里而不是塞进 package.json，是因为要写注释：
 * - 只打 dist/ 和 electron/，源码不进安装包
 * - asar 打包，避免用户翻到源文件
 * - Windows 出 NSIS 安装包（可选安装目录）+ 免安装 zip
 * - macOS 出 dmg，需要 arm64 和 x64 两个架构
 */
const path = require('node:path');
const os = require('node:os');

/**
 * NSIS 在生成卸载程序时会执行一次自己产出的安装包，
 * 如果**目录路径**里有中文（本项目就放在「忆尘记账」这种中文目录下），
 * 这一步会失败并报 `process failed 2`。文件名带中文没有问题，只有目录路径有影响。
 * 所以这里检测一下：路径有非 ASCII 字符就把产物丢到系统临时目录。
 */
function resolveOutput() {
  const projectDir = __dirname;
  // eslint-disable-next-line no-control-regex
  const hasNonAscii = /[^\u0000-\u007F]/.test(projectDir);
  if (hasNonAscii) {
    return path.join(os.tmpdir(), 'yichen-ledger-release');
  }
  return path.join(projectDir, 'release');
}

module.exports = {
  appId: 'com.yichen.ledger',
  productName: '忆尘记账',
  copyright: 'Copyright © 2026 yichen520-1',

  // 进安装包的文件：只要构建产物和主进程，不要源码/测试/脚本
  files: ['dist/**/*', 'electron/**/*', 'package.json'],
  directories: {
    output: resolveOutput(),
    buildResources: 'build',
  },
  // 不压缩成 asar 的话，用户能在安装目录里看到一堆散文件，也更容易被改
  asar: true,

  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
    icon: 'build/icon.ico',
    // 没有代码签名证书，明确关掉，否则构建会一直警告
    signAndEditExecutable: true,
    // 产物文件名用纯 ASCII：GitHub Release 会把资产名里的非 ASCII 字符
    // 统统替换成「.」，用中文名上传上去就变成 "-0.1.0.exe" 这种残废名字。
    // 安装后显示的名字、快捷方式、窗口标题仍然是「忆尘记账」，不受影响。
    artifactName: 'yichen-ledger-${version}-win-${arch}.${ext}',
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '忆尘记账',
    // 卸载时保留用户数据（IndexedDB 存在用户目录里，本来也不会被删）
    deleteAppDataOnUninstall: false,
  },

  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.finance',
    icon: 'build/icon.png',
    // 没有 Apple 开发者证书，跳过签名；否则打包会失败
    identity: null,
    // 同 win：Release 资产名必须是纯 ASCII
    artifactName: 'yichen-ledger-${version}-mac-${arch}.${ext}',
  },

  linux: {
    target: ['AppImage'],
    category: 'Office',
    icon: 'build/icon.png',
    artifactName: 'yichen-ledger-${version}-linux-${arch}.${ext}',
  },
};
