# 图标用的毛笔字体

这两个字体**只用来生成 app 图标**（`npm run make:icon`），不会打进安装包，也不用于界面排版。
界面里的中文一律走系统字体，所以安装包体积不受影响。

| 文件 | 字体 | 许可证 | 来源 |
| --- | --- | --- | --- |
| `ZhiMangXing-Regular.ttf` | 志莽行书 Zhi Mang Xing | SIL Open Font License 1.1 | [google/fonts](https://github.com/google/fonts/tree/main/ofl/zhimangxing) |
| `MaShanZheng-Regular.ttf` | 马善政毛笔楷书 Ma Shan Zheng | SIL Open Font License 1.1 | [google/fonts](https://github.com/google/fonts/tree/main/ofl/mashanzheng) |

两者都是 OFL 1.1，允许随作品一起分发，也允许用在商业项目里；
OFL 只要求保留字体名称与许可声明，不得单独售卖字体本身。

图标的「忆」用的是**志莽行书**（行草，比楷书更放得开），
印章上的「记」用系统自带的宋体（`simsun.ttc`）——宋体横细竖粗、横画起笔带顿角，
加粗后最像凿刻，而且不需要额外授权。

## 为什么这两个字体在仓库里但不在安装包里

`electron-builder.config.cjs` 的 `files` 只收 `dist/`、`electron/`、`package.json`，
`assets/` 不参与打包。字体只在开发机跑 `make:icon` 时被 Pillow 读一次。

想重新生成图标：

```bash
npm run make:icon        # 需要 Pillow：用 DSH 自带的 python，不是系统 python
```

## 如果只想换字体

把新的 `.ttf` 丢进这个目录，然后改 `scripts/make_icon_common.py` 里的
`BRUSH_FONT` / `CARVED_FONT` 两个常量即可。
