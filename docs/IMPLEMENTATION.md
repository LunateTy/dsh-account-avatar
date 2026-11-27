# 实现说明

给要改这个插件的人看。用户文档在 README，这里只记实现上的取舍和容易踩的坑。

## 账号菜单完全不动

头像只是被一层样式盖住，不是替换组件：

- Host 半边注册本机路由存图（`GET /account-avatar/api/state`、`POST /account-avatar/api/mutate`、`GET /account-avatar/api/image`），三条都过 `connection.requestRejection`，和官方本机路由同一套检查。
- Client 半边把当前图写成一条作用在头像位上的样式，原头像的 `img` 被隐藏、背景换成用户的图。

设置、意见反馈、退出登录、通知、额度这些菜单项都不碰。

## 头像位怎么定位

优先用原生标记 `[data-avatar-status]`。

**但从没上传过头像的账号，原生不渲染这个标记** —— 那种情况下按钮里是一个灰色人像图标。React 会丢弃值为 `undefined` 的属性，所以 `data-avatar-status={account.avatar?.status}` 对空头像账号不会输出。

插件给这种情况自己打一个 `data-ast-avatar` 标记再上样式，靠 `aria-haspopup` 找按钮，而不是依赖 CSS module 的哈希类名。

**未登录**时更极端：按钮里只有一个省略号加「更多」，没有任何可作为头像位的元素。插件追加一个 24×24 的节点，用 `order:-1` 排到最前。

这里有个必须守住的约束：**React 按索引协调子节点**。插入或删除兄弟节点会让后续节点的索引错位，所以只能 `appendChild` 追加，视觉顺序靠 CSS 的 `order` 解决；隐藏省略号也只能用 `display:none`，不能 `remove()`。

## 名字

改的是头像位里的文本节点。两个容易错的点：

- **脱敏手机号不是昵称**。只有手机号的账号 `id_profile` 是 `null`，DSH 自己那行也只能回退到 `1XX******XX` 这种。把它显示成 `@1XX******XX` 是噪声，所以 `@` 行只在有真昵称时出现。
- **换账号要能刷新**。早期版本只缓存一个名字字符串，换账号后新名字写不进去，侧栏会一直挂着上一个账号的名字。现在缓存 `{ name, contact }`，用脱敏联系方式做身份指纹，指纹变了就重新采。

另外，最后那次 DOM 变动往往就是渲染完成的信号。观察器带了 600ms 节流，所以节流窗口末尾补一次 `tail` 定时器，否则 bursts 的最后一个状态会被丢掉。

## 存储为什么有两套

- **Host 图库**：`$DSH_HOME/account-avatar/avatars.json`。换浏览器、清缓存都不丢。
- **浏览器图库**：`localStorage['dsh.account-avatar.library.v1']`。

桌面端用自定义 `dsh-app:` 协议加载界面，相对路径的 `/api/...` 请求没有处理器 —— `fetch('/account-avatar/api/state')` 解析成 `dsh-app://-/account-avatar/api/state`，永远不通。

所以启动时探测一次 `state` 路由：通了用 Host 图库，不通就用浏览器图库。`mutateLocal` 实现了同样的五个操作（add / select / remove / reset / shape / name），行为对齐，包括「存满 100 张顶掉最旧的，但正在用的那张不顶」。

**这个探测很重要**：早期版本直接 `ctx.get('webServer')` 拿不到就 `return`，结果是上传永远报「没写进本地存储」。

## 名字为什么先落本地

名字本来就是 device-local 设置，不该等 Host 往返才生效。现在先写 `localStorage`、先更新 UI，再尽力同步 Host；同步失败只提示「已在本机生效，没同步给后台」，而不是「保存失败」—— 后者在路由不通时是假话。

## 已知失效条件

DSH 改了账号菜单结构就会失效：菜单按钮不再带 `aria-haspopup`，或头像位不再是「带图标的方形 span」。这时自定义标记打不上，替换停止生效 —— 不会报错，只是显示回原生头像。