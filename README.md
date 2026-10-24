# graphomata-cpp

Graphomata 的机器，配上 C++ / Python 的编程接口。

保留原作的硬约束——7 个 worker、5 个改图原语、随机 `WALK`、GC——但把「拖拽建程序」
换成「写代码」。图形界面不再是输入方式，而是回放与调试器。

**[设计方案（中文）→ DESIGN.md](DESIGN.md)** · **[Pointer 模式规格 → docs/pointer-mode.md](docs/pointer-mode.md)** · **[C++ 模式方案 → docs/cpp-mode.md](docs/cpp-mode.md)** · **[经典 API v2 → API.md](API.md)**

![replay](docs/reverse.gif)

## 网页版（浏览器 demo）

**在 WSL 里**（推荐）：一条命令起服务并打开 Windows 浏览器。

```bash
./tools/serve
```

它会自动判断 Windows 能不能访问 `localhost`（不通就换成 WSL 的 IP），然后依次尝试
`wslview`、`cmd start` 和 Edge/Chrome/Firefox 的可执行文件来打开浏览器。
**打开成功的判据是服务器真的收到了浏览器请求**，所以像“默认浏览器关联损坏、
`Start-Process` 返回成功但其实没打开”这种情况会自动跳到下一个方案。

```bash
./tools/serve --port 9000 --no-open            # 只起服务
./tools/serve --browser 'C:\Program Files\...\msedge.exe'   # 指定浏览器
```

如果在原生 Linux / macOS 上：

```bash
./tools/serve            # 或直接打开 web/index.html
```

默认打开的是 **pointer mode**（`web/ptr/`）：

- 没有 worker。变量就是节点引用，`None` 表示空；
- 一步 = 一次图操作；赋值与外层调用合并（`a = b.next()` 1 步，`a = b` 单独 1 步）；
- 支持 `for _ in range(n):` 计数循环（`n` 是整数常量，`_` 不能当变量）；
- **Python / C++ 两种写法**：编辑器顶部切换，C++ 侧 `Node*` / `nullptr` / `->` / `loop(n)`，进度按语言分开（见 [C++ 模式](docs/cpp-mode.md)）；
- GC 从 active 引用出发**沿出边**做可达标记，走不到的节点回收（`s = s.next()` 后旧节点就没了）；
- 判题看**图形状** + **峰值引用数**（active 变量 + 临时值），临时值显示成 `a.next()`；
- 每关有 `max_refs`：这就是这一关的“寄存器预算”；
- 画布上的节点可以**拖动**，拖过的节点会钉住（`重置`或换关后解除）；
- 支持**单步 / 后退一步 / 连续运行**：后退只回放已记录的帧，不回滚执行；
- **多组测试点**：下拉框里直接选测试点；运行/单步只测当前这个，**提交**才跑全部；
  全过才算过关，失败会自动切到第一个错掉的测试点（04/05/06/07/10 有不同大小的数据）。

| # | 关卡 | 难度 | 考点 | 测试点 | peak 上限 | 参考解 |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Hello, node | 入门 | `Node` / `link` | 1 | 2 | 2 步 |
| 02 | Grow a chain | 入门 | `next` / `link` | 1 | 3 | 10 步 |
| 03 | Fork | 简单 | 分叉 | 1 | 2 | 4 步 |
| 04 | Close the ring | 简单 | 循环 = 状态 | 4（4/6/10/20 节点） | 3 | 9 步 |
| 05 | Open the ring | 简单 | `unlink` | 4（6/8/10/20 节点） | 2 | 2 步 |
| 06 | Copy a chain | 中等 | 复制 = 新内存 | 5（4/6/8/10/20 节点） | 4 | 18 步 |
| 07 | Double links | 中等 | 双向指针 | 4（4/6/10/20 节点） | 4 | 18 步 |
| 08 | Diamond | 中等 | 路径汇聚 | 1 | 4 | 7 步 |
| 09 | Binary tree | 困难 | 递归结构 | 1 | 4 | 12 步 |
| 10 | Ladder | 挑战 | 并行内存 | 3（4/6/10 节点） | 6 | 26 步 |
| 11 | Copy a ring | 困难 | 环 + 身份 | 4（4/6/10/20 节点） | 6 | 16 步 |
| 12 | Copy a rho | 挑战 | Floyd 判环 | 5（5/5/8/13/20 节点） | 8 | 44 步 |

这条线是「图就是内存」：链 → 环 → 复制 → 双向指针 → 汇聚 → 树/梯子。
语言本身是图灵完备的（可增长的图 + 循环 + 节点身份比较），这 10 关是它的入口。

经典 worker 模式还在 **[web/classic.html](web/classic.html)**（6 关、ops 预算、API v2）。
C++ 仍走桌面端的 `tools/gmj`。方案与规则细节：[docs/pointer-mode.md](docs/pointer-mode.md)。

> 打不开时：Windows 浏览器如果配了系统代理，把 `localhost` 加进代理例外；
> 或者直接用 `./tools/serve` 打印出来的 `http://<wsl-ip>:8000/web/`。

## 部署到 GitHub Pages

`web/` 是纯静态站点（无构建、无 fetch、全部相对路径），可以直接托管：

1. 仓库 **Settings → Pages → Build and deployment → Source: GitHub Actions**；
2. push 到 `main`（或手动跑 `pages` workflow）；
3. 站点地址是 `https://<user>.github.io/<repo>/`，`web/index.html` 会自动跳到 `ptr/`。

工作流在 `.github/workflows/pages.yml`，上传的是整个 `web/` 目录；
经典 worker 模式在 `https://<user>.github.io/<repo>/classic.html`。

### Gitee Pages

也能托管（同样是纯静态），但 Gitee Pages 需要**公开仓库 + 实名认证**，而且更新后通常要手动点一次「更新」：

- 如果仓库的 Pages 设置支持选目录：选 `master` + `/web`；
- 如果只支持分支根：把 `web/` 推到 `pages` 分支：

```bash
git subtree push --prefix web origin pages
```

然后在仓库 **服务 → Gitee Pages** 里选 `pages` 分支部署。

地址是 `https://<user>.gitee.io/<repo>/`。Gitee Pages 偶尔会维护或调整策略，
入口不可用时可以退回 GitHub Pages / Cloudflare Pages / Netlify。

## 快速开始

```bash
# 全部关卡 × 全部 seed × 两种语言
./tools/gmj all

# 单关，带逐行成本
./tools/gmj run levels/03-reverse.json examples/cpp/03_reverse.cpp --cost

# 证明两种语言语义一致（逐帧 diff）
./tools/gmj diff

# 把一次运行渲染成 GIF
./tools/gmj gif levels/03-reverse.json examples/py/03_reverse.py --out reverse.gif

# VM 单元测试
python3 -m unittest discover -s tests
node web/test.js              # 浏览器引擎的参考解回归测试
node web/smoke.js             # UI 状态机冒烟测试
```

环境：`g++ >= 11`（C++20 `source_location`）、`python3 >= 3.10`、`Pillow`（仅渲染）。

## 写一个解法

C++：

```cpp
#include <graphomata/gm.hpp>

void gm_solve(gm::World& w) {
  using namespace gm;
  auto [nxt, spare] = w.spares<2>();
  w.peek(nxt, A);
  while (w.at(nxt)) {
    w.peek(spare, nxt);
    w.unlink(A, nxt);
    w.link(nxt, A);
    w.join(A, nxt);
    w.join(nxt, spare);
  }
}
```

Python：

```python
from graphomata import A, World

def solve(w: World) -> None:
    nxt, spare = w.spares(2)
    w.peek(nxt, A)
    while w.at(nxt):
        w.peek(spare, nxt)
        w.unlink(A, nxt)
        w.link(nxt, A)
        w.join(A, nxt)
        w.join(nxt, spare)
```

两个文件跑出来是**同一个 20 op 的 trace**。

## 关卡

| # | 关卡 | 考点 | 预算 | 参考解 |
| --- | --- | --- | --- | --- |
| 01 | Hello, node | `NODE` | 3 | 1 op |
| 02 | Grow a chain | `NODE`+`LINK`+`JOIN` | 12 | 9 ops |
| 03 | Reverse the path | 随机游走、前瞻、反向边污染 | 26 | 20 ops |
| 04 | Clone a chain | 分配、GC、保持原图 | 26 | 22 ops |
| 05 | Random search | 随机 `WALK` 与多 seed 判定 | 400 | 3–33 ops |

## 仓库结构

```
include/graphomata/gm.hpp   VM + 记账 + trace（C++ 单头文件，无依赖）
python/graphomata/          Python 镜像 + 判定器 + 渲染器
tools/harness.cpp           C++ 运行入口（spec.txt → trace.json）
web/ptr/                    pointer 模式（变量 = 节点引用，峰值计分）
web/classic.html            经典 worker 模式页面
tools/gmj                   CLI 包装
levels/*.json               关卡定义
examples/{cpp,py}/          参考解
tests/                      单元测试
```
