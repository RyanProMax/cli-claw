# PWA Icons

## 自动生成

PNG 图标通过 `npm run generate-icons` 从 `web/public/favicon.svg` 自动生成。构建时会自动运行此脚本。

## 图标规格

- `favicon.svg`: SVG 单一源文件
- `icon-192.png`: 192x192px，用于 Android 设备
- `icon-512.png`: 512x512px，用于高分辨率设备和启动画面
- `logo-1024.png`: 1024x1024px，用于品牌和衍生资源

## 自定义图标

如需更新图标：

1. 编辑 `web/public/favicon.svg`
2. 运行 `npm run generate-icons` 重新生成 PNG
3. 如需同步品牌 SVG，替换 `icons/` 下的 `logo-*.svg` / `loading-logo.svg`
