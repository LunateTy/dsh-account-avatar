# dsh-account-avatar

把 DeepSeek Harness 左侧栏最下面那个头像，换成自定义上传的图片。在设置里上传一张图片，拖动调整裁成方形，并且保存 —— 刷新、重启浏览器、换端口都不丢。账号菜单本身完全不动：设置、意见反馈、退出登录、通知和额度提醒都保持原样。

## 为什么做这个

左下角显示的是 DeepSeek 平台账号的头像。用微信登录或者绑定微信的情况下就是微信头像 —— 在微信登录的时候无法单独修改dsh头像。
DSH 本身没有这个选项：那个位置读的是 `AccountProfile.avatarUrl`，只读，账号服务也没有任何设置接口。这个插件只在自己的机器上盖一层图。
## 安装

```sh
dsh plugin --profile web add dsh-account-avatar
```

装完刷新页面。

## 使用

1. 设置（`Ctrl+Alt+,`）→ **头像**。
2. **上传图片** —— PNG / JPEG / WebP / GIF，12 MB 以内。
3. 拖动调整位置，滚轮或滑块缩放。
4. **保存**。

**换一张**替换当前图片，**恢复默认**回到账号原来的头像。

## 存放位置

- `$DSH_HOME/account-avatar/avatar.json` —— 持久副本。Host 半边通过 `GET/POST /account-avatar/api/state|avatar` 读写，两条路由都过了和官方本机路由同一套 `connection.requestRejection` 检查。
- `localStorage['dsh.account-avatar.v1']` —— 浏览器侧的副本，让第一帧就显示你的图，不会先闪一下账号头像。

存下来的图是 256×256 的 WebP（浏览器不支持 WebP 时用 PNG），通常 20–60 KB。图片只在这台机器上处理，不上传任何服务器。

## 已知限制

- 头像由一条作用在官方 `[data-avatar-status]` 标记上的样式重绘。如果某个 DSH 版本改了这个标记，替换会失效 —— 不会报错，只是又显示回账号头像。
- 只在登录状态下生效，因为那个元素只存在于登录后的账号位。未登录时那里是省略号加「更多」，本来就没有头像可换。
- Host 存储依赖 Web GUI 的 HTTP 服务。用 `file://` 加载界面的壳只走浏览器缓存。
- 纯本机个人化：DeepSeek 账号完全没动，别人、别的浏览器、别的机器看到的仍是账号头像。

## 许可

MIT