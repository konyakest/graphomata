# Graphomata API v2 —— 指针风格

> 状态：**网页版已实现**（`web/py.js`）；桌面 Python / C++ 仍是 v1，迁移清单在 §8。
> 这份文档按草稿的写法重新定义了 cursor 的用法，并标出三处必须偏离草稿的地方。
> 想看效果：[docs/api-v2-demo.md](docs/api-v2-demo.md)。

---

## 1. 为什么改

v1 的每个动作都挂在 `w` 上，cursor 只是常量：

```python
w.join(A, nxt)      # 读起来像“世界让 A 加入 nxt”
w.link(nxt, A)
if w.at_home(nxt): ...
```

v2 把 cursor 变成对象，动作挂在 cursor 上：

```python
a.join(nxt)
nxt.link(a)
if nxt.home(): ...
```

规则只有一条：**谁动，方法就挂在谁身上。**

---

## 2. 对象

| 名字 | 是什么 | 花 op |
| --- | --- | --- |
| `w` | 世界（关卡、预算、judge） | — |
| `w.start()` | 关卡起点 cursor（worker a，owned） | 0 |
| `w.target()` | 关卡停在目标上的 cursor（只有需要它的关卡才有） | 0 |
| `w.home()` | home 哨兵，可以和 cursor 比较 | 0 |
| `Cursor` | 一个 worker 的句柄；`pos()` 拿节点 id | — |

```python
a = w.start()          # 不花 op，只是拿到句柄
b = w.target()         # 只在这关有目标 cursor 时
```

`w.start()` **不是工厂**：每次调用返回同一个 cursor（关卡放在起点的那个）。
想要第二个 cursor 站在起点，用 `w.start().copy()`（1 op）；借备用 cursor 用 `w.spare()`。
两个变量指向同一个 worker 时，`walk()` 会一起动。

---

## 3. 语法速查

### 新建与移动

| 写法 | 含义 | 展开成原语 | ops |
| --- | --- | --- | --- |
| `w.node(a)` | 新建节点，`a` 站上去；返回 `a` | NODE a | 1 |
| `w.node()` | 新建节点，自动拿一个空闲 worker；返回新 cursor | spare + NODE | 1 |
| `a.copy()` | 复制一个 cursor 站在 `a` 的位置 | spare + JOIN | 1 |
| `a.join(b)` | `a` 走到 `b` 的位置 | JOIN a,b | 1 |
| `a.walk()` | `a` 沿随机出边走一步 | WALK a | 1 |
| `a.walk(n)` | 连走 n 步 | WALK × n | n |
| `a.next(n=1)` | 前瞻 n 步：临时 cursor 站在第 n 个邻居 | copy + walk×n | 1+n |
| `a.park()` | `a` 回家，释放寄存器 | JOIN a,H | 1 |

### 边

| 写法 | 含义 | ops |
| --- | --- | --- |
| `a.link(b)` | 加边：`a` 所在节点 → `b` 所在节点 | 1 |
| `a.unlink(b)` | 删除这条有向边 | 1 |

### 读（都免费）

| 写法 | 含义 |
| --- | --- |
| `a == b` | 是否站在同一个节点（都在 home 也算） |
| `a != b` | 取反 |
| `a == w.home()` | 是否在 home |
| `a.home()` | 是否在 home（`a == w.home()` 的简写） |
| `a.pos()` | 所在节点 id，home 时为 `-1` |
| `a.at(node_id)` | 是否站在指定节点上 |

### 寄存器

| 写法 | 含义 | ops |
| --- | --- | --- |
| `w.spare()` | 返回一个空闲 cursor（**查询，不占用**） | 0 |
| `w.spares(k)` | 返回 k 个不同的空闲 cursor | 0 |
| 没有空闲寄存器时 | `w.spare()` / `.copy()` / `.next()` 抛 `OutOfRegisters` | — |

---

## 4. 代价是怎么算的

**只有改变世界状态的动作计费**，读全部免费。每个方法都能精确展开成原语，没有隐藏操作：

```python
c = a.next()      # copy + walk        → 2 ops
c = a.next(2)     # copy + walk × 2    → 3 ops
c.walk(2)         # walk × 2           → 2 ops
c = a.copy()      # copy               → 1 op
```

`a.next()` 是"复制 + 走一步"，所以它**同时占用一个新的寄存器**：

```python
if c.next().home():      # 花 2 ops；如果 c 没有下一个邻居，临时 cursor 直接回家
    ...
```

临时 cursor 的自动回收**不计费**（这是 API 层的一处补贴，见 §6.3）。

---

## 5. 临时 cursor

`next()` 和 `node()` 返回的是**临时 cursor**：它只在当前表达式里活着，用完自动回家。

```python
d = c.next(2)            # 只复制一次，走两步
```

规则：

1. 临时 cursor 在**它所在的最小表达式**求值完后自动回家，**不花 op**（不是等整条语句结束）；
2. 被变量接住的临时 cursor 变成**持久 cursor**（owned）；
3. 持久 cursor 被**重新赋值**时自动释放（如果还有别的名字引用它，就不释放），也可以 `park()` 主动释放；
4. 临时 cursor 也占寄存器——`c.next(3)` 只占 1 个，写成 `c.next().next().next()` 会同时占 3 个。

```python
nxt = c.next()           # 持久（被 nxt 接住）
if nxt.home(): ...       # 临时值在 .home() 返回后立刻回收
```

回收点是"最小表达式"，所以同一个表达式里的两个临时 cursor **不一定同时占用**：

```python
if a.next() != w.home() and a.next(2) != w.home():
    ...
```

- 左边 `a.next()`：2 ops，比较完就被回收；
- 右边 `a.next(2)`：3 ops，只在前一个为真（不短路）时才求值；
- 全程最多只有 **1 个**临时 cursor 活着 → 峰值寄存器 +1；
- 总 ops：两个都求值 = 5；左边短路 = 2。

对比 `a.next() != b.next()`：两个操作数都要参与比较，两个临时同时活着 → 峰值 +2。

### 渲染

网页版里 worker 本身就是一块带颜色的名字胶囊（`nxt`、`$1`），同一个 worker 有多个别名时显示 `a,b`；
没有名字的 worker 才退回显示字母。变量名只是渲染用的标签，不改变任何语义。

`w.start()` 返回的 cursor 是 owned 的：`a = w.start()` 之后再用 `a = ...` 覆盖它，起点会被回收
（worker 回家）。有些关卡的目标要求起点停在某个位置（比如 "Grow a chain" 的链尾），覆盖它就会失败。

---

## 6. 和草稿的三处不同

### 6.1 `c = a` 必须是 `c = a.copy()`

Python 的 `=` 是**重新绑定名字**，不可能触发 JOIN：

```python
a = w.start()
c = a
c.walk()      # a 也走了 —— c 和 a 是同一个 worker
```

要独立 cursor 就显式复制：

```python
c = a.copy()  # 1 op，c 和 a 是两个 worker，可以各走各的
```

这不是设计选择，是语言限制。除非把代码框换成自定义 DSL，否则 `c = a` 只能是别名。
好消息是：需要独立 cursor 的地方基本都能用 `.next()` 或 `.copy()` 表达，实际影响很小。

### 6.2 不要写 `.next().next()`，写 `.next(2)`

`.next()` 的每一步都是一次复制 + 一次 walk。写成链式时，第一个临时 cursor 必须一直活着，
因为它是第二次 `next()` 的接收者，所以要多占一个寄存器、多花一次复制：

```python
d = c.next().next()      # 4 ops，同时占 2 个寄存器
d = c.next(2)            # 3 ops，只占 1 个寄存器
```

两者结果一样（都在两步之外），差别只在多出来的那次复制。规则：

- **只要终点** → `c.next(2)`；
- **要中间那个节点** → 显式接住：`nxt = c.next(); nn = nxt.next()`（这时 4 op 是必要的，两个节点都得用）。

`.next().next()` 语法上仍然合法（它就是两次 `next()`），但编辑器会提示改成 `.next(n)`。

### 6.3 临时 cursor 的回收免费

严格按原语算，回家是一次 `JOIN x,H`，应该收 1 op。我们把临时 cursor 的回收**豁免**了，
否则 `if c.next().home()` 这种最常用的写法会变成 3 op，而且代价取决于编译器怎么回收临时值，很难心算。

这是本版本唯一一处"不计费的世界变化"。如果要严格计费，加一个关卡开关 `strict_temps: true`。

---

## 7. 用新 API 写关卡

### 03 reverse（v2 版，17 ops）

```python
def solve(w):
    a = w.start()
    nxt = a.next()               # 2
    while not nxt.home():        # 0
        nn = nxt.next()          # 2（要留住 nxt，所以不能用 next(2)）
        a.unlink(nxt)            # 1
        nxt.link(a)              # 1
        a.join(nxt)              # 1
        nxt = nn                 # 0，旧的临时 cursor 免费回收
```

### 04 clone（v2 版，21 ops）

```python
def solve(w):
    src = w.start()
    dst = w.node()               # 1
    while True:
        nxt = src.next()         # 2
        if nxt.home():           # 0
            break
        fresh = w.node()         # 1
        dst.link(fresh)          # 1
        dst.join(fresh)          # 1
        src.join(nxt)            # 1
```

### 05 seek

```python
def solve(w):
    a, b = w.start(), w.target()
    while a != b:                # 0
        a.walk()                 # 1
```

---

## 8. 从 v1 迁移

| v1 | v2 |
| --- | --- |
| `w.node(A)` | `w.node(w.start())`，或 `c = w.node()` |
| `w.walk(A)` | `w.start().walk()` |
| `w.join(c, a)` | `c.join(a)` |
| `w.link(a, b)` | `a.link(b)` |
| `w.unlink(a, b)` | `a.unlink(b)` |
| `w.test(a, b)` | `a == b` |
| `w.at_home(a)` | `a.home()` |
| `w.at(a)` | `not a.home()` |
| `w.pos(a)` | `a.pos()` |
| `w.peek(dst, src)` | `dst = src.next()`（n 步：`src.next(n)`） |
| `w.park(a)` | `a.park()` |
| `A`（常量） | `w.start()` |

实现要改三处：

1. **Python**（`python/graphomata/core.py`）：加 `Cursor` 类、`World.start()` / `World.b`…`World.g`、`World.home()/node()`；`__eq__` 走 TEST；临时 cursor 用 `__del__` 回收（CPython）。
2. **Web**（`web/py.js`）：加 Cursor 对象、`==` 走 TEST、语句结束时回收临时 cursor。
3. **C++**（`include/graphomata/gm.hpp`）：加 `gm::Cur` 包装类；`w.start()` 变成 `w.start()`，`spares<2>()` 返回 `Cur` 对。

关卡 JSON 和判定器不用动——它们只看最终的图。

### 迁移顺序

1. ~~网页层~~（已完成：`web/py.js`，6 关全部跑通，reverse 17 op / clone 22 op / even 25 op）；
2. 再把同一套搬到 `web/py.js`，用 `web/test.js` 对比 ops；
3. 加一条 lint：`.next()` 直接接 `.next()` 时提示改成 `.next(n)`，然后换掉示例、提示和 README 里的代码；
4. C++ 层可以放到最后（它只影响桌面端）。
