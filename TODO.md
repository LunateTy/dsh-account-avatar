# 待做事项

按优先级排，每条写清楚「为什么」和「怎么验证」，避免下次接手时只剩一个标题。

## 1. 桌面端走 Host 持久化，不再依赖 localStorage

**现状**：桌面端用自定义 `dsh-app:` 协议加载界面，相对路径的 `/api/...` 没有处理器，插件探测到路由不可用后落到浏览器本地库 `localStorage['dsh.account-avatar.library.v1']`。

**问题**：清浏览器缓存、换浏览器、换设备都会丢图和名字。100 张 256×256 图约 5MB，接近 localStorage 容量上限，存满后只能报配额错误。

**方向**：走 Cordis 的服务注入而不是 HTTP 渲染路径 —— 桌面端的宿主进程和渲染进程之间已有 IPC 通道，`ctx.get('storage')` / `dsh-storage-json` 是可用的。需要确认桌面端半边到底暴露了哪个服务给 client。

**验证**：清 localStorage 后重启，头像和名字仍在；`$DSH_HOME/account-avatar/avatars.json` 里有内容。

## 2. `docs/DETAIL.md` 补上本地库降级链路

**现状**：`DETAIL.md` 跟着 README 更新了实现说明，但没写第 1 条里那套「探测 → 分流 → 本地库」的完整逻辑，也没写 `mutateLocal` 五个操作各自的语义（尤其是「淘汰最旧但不淘汰正在用的」）。

**为什么现在做**：这是整个插件最反直觉的一层，将来改任何存储相关代码都会先撞上它。

## 3. npm 发布

**现状**：`package.json` 是 `0.2.0`，`files` 已包含 `assets/*.png`，仓库已推到 GitHub，但还没发 npm。

**发布前检查**：

- `dsh plugin --profile web add dsh-account-avatar` 能否从 npm 装成功
- README 三张图的路径在 npm 页面上是否正常显示
- `icon.svg` 在市场里的效果

## 4. 截图脚本改为读配置

**现状**：`assets/crop-screenshots.py` 里 `SCREENSHOTS` 和 `OUTPUT_PREFIX` 写死。换截图要改名或改脚本。

**影响**：小，但下次换图会被绊一下。可以接受命令行参数或从目录自动发现 `screenshot-*`。

## 5. 性能：历史很多时的缩略图渲染

**现状**：历史最多 100 张，全部一次性渲染成 `<button>`。每张 96×96 缩略图约 4KB data URL，100 张约 400KB DOM 里的字符串。

**风险**：目前实测没问题（3 张时打开设置无感知延迟），但 100 张时可能有渲染卡顿。没有实测过。

**验证方式**：造 100 张的库，量打开设置到首帧的时间。真卡了再考虑虚拟滚动或懒加载。