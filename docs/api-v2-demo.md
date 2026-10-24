# API v2 Demo —— 同样的题，换一套语法

这不是新引擎，还是那台机器：7 个 worker、5 个原语、随机 WALK、GC。
变的是你写代码的手感。

三道题，全部可以直接在网页版里跑（`./tools/serve`，第 3/4/6 关）。

---

## 1. Reverse the path：20 op → 17 op

**v1**（`w.join(c, a)` 那套）：

```python
def solve(w):
    nxt, spare = w.spares(2)
    w.peek(nxt, A)
    while w.at(nxt):
        w.peek(spare, nxt)
        w.unlink(A, nxt)
        w.link(nxt, A)
        w.join(A, nxt)
        w.join(nxt, spare)
```

**v2**：

```python
def solve(w):
    a = w.start()
    nxt = a.next()
    while not nxt.home():
        nn = nxt.next()
        a.unlink(nxt)
        nxt.link(a)
        a.join(nxt)
        nxt = nn
```

> `a = nxt.copy()` 也是合法解法：它会释放起点，把 `a` 指向一个新 cursor（同样 17 op）。
> 这一关的目标只查图的形状（tag 节点已经能区分正反），所以起点停在哪都行。

改了什么：

- `w.unlink(A, nxt)` → `a.unlink(nxt)`：**谁动，方法就挂在谁身上**；
- `w.peek(nxt, A)` → `a.next()`：前瞻不再需要手动挑一个 spare；
- `w.at(nxt)` → `not nxt.home()`：判断在不在节点上；
- `w.join(nxt, spare)` 这个"把 spare 挪到下一个节点"的动作，被 `nxt = nn` 一行取代：
  `nn` 是 `next()` 刚产生的临时 cursor，旧的 `nxt` 在重新绑定的时候自动回收。

省下来的 3 op 不是靠魔法：v1 的 `spare` 每个 loop 都要额外 `join` 一次，
v2 直接让 `next()` 每次都产生一个新的临时 cursor。

---

## 2. Even out（新关卡）：删除 + GC

题目：`0→1→2→3→4→5`，删掉下标为奇数的节点，只留 `0→2→4`，A 不动。

```python
def solve(w):
    cur = w.start().copy()          # 1  op，复制一个 cursor 当遍历指针，A 留在原地
    nxt = w.spare()           # 0  op，借两个空闲 worker
    nn = w.spare()
    while True:
        nxt.join(cur)         # 1  op，nxt := cur
        nxt.walk()            # 1  op，nxt 走到下一个
        if nxt.home():        # 0  op
            break
        nn.join(nxt)          # 1  op，nn := nxt
        nn.walk()             # 1  op，nn 再走一个
        cur.unlink(nxt)       # 1  op，断开 cur -> nxt
        if nn.home():         # 0  op，nxt 是尾巴
            nxt.park()        # 1  op，回家 → 节点被 GC
            break
        nxt.unlink(nn)        # 1  op，断开 nxt -> nn
        cur.link(nn)          # 1  op，cur -> nn
        nxt.park()            # 1  op，nxt 此时已经孤立，立刻被回收
        cur.join(nn)          # 1  op，cur 前进到 nn
```

25 op。注意几件事：

- `w.start().copy()` 让 A 留在 0，遍历用副本 —— 这是 v2 里唯一需要显式 `copy` 的地方；
- `nxt.park()` 不是"清理"，是**解法的一部分**：断完边之后它站着的节点必须被回收，
  否则 `nodes: 3` 永远不成立；
- 全程没有一个 `w.xxx(a, b)` 的双参数调用，读起来就是指针操作。

---

## 3. 为什么读起来短

| v1 的写法 | v2 的写法 | 省掉的 |
| --- | --- | --- |
| `w.unlink(A, nxt)` | `a.unlink(nxt)` | 一个参数 |
| `w.test(a, b)` | `a == b` | 一个函数调用 |
| `w.at_home(nxt)` | `nxt.home()` | 一个函数调用 |
| `w.peek(dst, src)` | `src.next()` | 手动挑 spare |
| `w.join(nxt, spare)` + 挪 spare | `nxt = nn` | 一整个动作 |
| `w.spares(2)` | `w.spare()` × 2 | 元组解包 |

真正的收益不是少打几个字，而是**每个表达式只描述一件事**：
`a.unlink(nxt)` 的主语是 `a`，宾语是 `nxt`；`a.next()` 是"从 a 出发能到哪"。
在 v1 里这两个信息都被 `w.` 吞掉了。

---

## 4. 节点上的变量名

网页版里 **worker 本身就是一块带颜色的名字胶囊**：

```text
   [nxt]        ← 有颜色的 worker，写着变量名
     │
    (n1)
```

临时值（还没被变量接住的 `next()` 结果）显示成 `$1`、`$2`；一旦被赋值，`$1` 就变成 `nxt`。
`b = a` 时同一个 worker 上会显示 `a,b`。没有名字的 worker 退回显示字母（`a`–`g`）。

这不需要改语义，也不需要 AST 变换——解释器执行赋值语句时本来就知道变量名，
渲染层拿到 name → worker 的映射画出来就行。

## 5. 现在就能跑

```bash
./tools/serve          # 打开网页版，选 03 / 04 / 06 关
```

浏览器里是 v2（`web/py.js` 已实现 Cursor 对象、`==`、`next(n)`、临时 cursor 回收）。
桌面端的 Python / C++ 还是 v1，迁移清单见 [API.md §8](API.md)。
