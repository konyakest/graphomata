# 新关卡目录（20 个）

> 现有 12 关不动；这里是 **20 个新关卡**的完整设计，可以直接排进章节。
> 另外有一个 bonus（第 21 个）：**Copy a tree**，已经上线（见文末）。
> 标 ✅ 的已经用当前引擎跑过参考解，步数/峰值是实测；标 ◇ 的是设计完成、参考解待写。

---

## 约束回顾

- **遍历骨架必须出度 1**：`next()` 在出度 > 1 时随机，遍历前先读 `nxt` 再连边；
- **GC 沿出边**：返回节点所在分量活下来，其余回收；复制类关卡用 `return_new`；
- **判题是形状同构**：已换成 1-WL + VF2，19/20 节点的图也能判；
- **没有整数**：计数用链长或 `loop(n)` / `range(n)` 常量；
- 峰值引用是预算：难一点的题通常 4–8 个。

---

## 总表

| # | 名称 | 建议章节 | 难度 | 输入 → 目标 | 测试点 | 参考解（步/峰值） | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Star | 1 | 入门 | 1 节点 → 中心 + 3 个叶子 | 1 | 6 / 2 | ✅ |
| 2 | Extend a chain | 1 | 入门 | n 链 → n+3 链 | n = 4/8/12 | 17/25/33 / 3 | ✅ |
| 3 | Cut the prefix | 1 | 简单 | n 链，走 2 步后返回 | n = 6/8/10 | 2 / 2 | ✅ |
| 4 | Drop the tail | 1 | 简单 | n 链 → n−1 链 | n = 4/5/6 | ≈4n / 3 | ✅ |
| 5 | Ring with a tail | 2 | 中等 | n 环 → 环 + 长度 3 的尾巴 | n = 4/6/8 | 10 / 3 | ✅ |
| 6 | Triple chain | 2 | 中等 | n 链 → 3n+1 链 | n = 2/3/4 | 10n+2 / 4 | ✅ |
| 7 | Thin out | 2 | 中等 | 2n 链 → n 链（原地） | 2n = 4/6/8 | 5n+1 / 6 | ✅ |
| 8 | Reverse copy | 2 | 中等 | n 链 → 新的 n+1 链（倒序） | n = 3/4/5 | 4n+1 / 4 | ✅ |
| 9 | Doubly linked ring | 2 | 困难 | n 环 → 每个节点带 prev 的环 | n = 4/6/8 | 4n / 6 | ✅ |
| 10 | Comb | 2 | 困难 | n 链 → 每个节点挂一个叶子 | n = 3/4/5 | ≈4n+1 / 5 | ✅ |
| 11 | Caterpillar ring | 2 | 困难 | n 环 → 每个环节点挂一个叶子 | n = 3/4/5 | ≈4n+3 / 5 | ✅ |
| 12 | Ring of rings | 2 | 挑战 | n 环 → 每个节点挂一个 3-环 | n = 2/3 | ≈10n+1 / 8 | ✅ |
| 13 | Square chain | 3 | 困难 | n 链 → 1+2n² 链 | n = 2/3 | 36/73 / 7 | ✅ |
| 14 | Threaded tree | 3 | 挑战 | d 链 → 深度 d 满二叉树 + 每层线程链 | d = 2/3 | O(2^d) / ≈9 | ◇ |
| 15 | Exponential chain | 3 | 挑战 | n 链 → 2ⁿ 链 | n = 3/4 | O(2ⁿ) / ≈6 | ◇ |
| 16 | Ternary tree | 3 | 中等 | 根 → 深度 2 满三叉树（13 节点） | 1 | 24 / 5 | ✅ |
| 17 | 3×3 grid | 3 | 挑战 | 根 → 3×3 网格（9 节点，12 边） | 1 | ≈40 / ≈7 | ◇ |
| 18 | Hypercube Q3 | 3 | 挑战 | 根 → 3 维超立方（8 节点，12 边） | 1 | ≈50 / ≈6 | ◇ |
| 19 | Copy a doubly linked ring | 3 | 挑战 | n 环 → 新的带 prev 的环 | n = 4/6 | O(n) / ≈8 | ◇ |
| 20 | Turing tape | 3 | 变态 | 纸带编码 → 模拟固定 TM k 步 | 固定 | — | ◇ |

---

## 第一章扩展（带参考解）

### 1. Star ✅

- **输入**：1 个节点；**目标**：中心 + 3 个叶子（4 节点，3 边）；
- **测试点**：1；
- **参考解**：

```python
def solve(s):
    for _ in range(3):
        s.link(Node())
    return s
```

- **实测**：6 步，峰值 2。
- **考点**：`Node()` 临时值 + `link` 连续用；C++ 用 `loop(3)`。
- **预算**：`max_refs 2`，`max_steps 10`。

### 2. Extend a chain ✅

- **输入**：n 节点链；**目标**：在尾巴上再接 3 个节点（n+3 链）；
- **测试点**：n = 4 / 8 / 12；
- **参考解**：

```python
def solve(s):
    p = s
    while p.next() is not None:
        p = p.next()
    for _ in range(3):
        p.link(Node())
        p = p.next()
    return s
```

- **实测**：n=4/8/12 → 17/25/33 步，峰值 3。
- **考点**：先走到尾巴，再用固定 3 次的 `range` 追加；输入长度可以变，追加次数是常量。
- **预算**：`max_refs 3`，`max_steps 3n+15`。

### 3. Cut the prefix ✅

- **输入**：n 节点链；**目标**：只保留后 n−k 个节点，返回新的头；
- **测试点**：(n,k) = (6,2) / (8,3) / (10,4)；
- **参考解**：

```python
def solve(s):
    for _ in range(2):
        s = s.next()
    return s
```

- **实测**：(6,2) → 2 步，峰值 2。
- **考点**：有向 GC——前 k 个节点没有引用后自动回收；这是理解 GC 最短的一关。
- **预算**：`max_refs 2`，`max_steps k+5`。

### 4. Drop the tail ✅

- **输入**：n 节点链；**目标**：n−1 节点链（删最后一个节点）；
- **测试点**：n = 4 / 5 / 6；
- **参考解**：

```python
def solve(s):
    p = s
    while p.next() is not None and p.next().next() is not None:
        p = p.next()
    p.unlink(p.next())
    return s
```

- **实测**：n=5 → 18 步，峰值 3。
- **考点**：前瞻（`p.next().next()`），删边后最后一个节点被 GC。
- **预算**：`max_refs 3`，`max_steps 5n`。

---

## 第二章扩展（无参考解）

### 5. Ring with a tail ✅

- **输入**：n 节点环；**目标**：环 + 从起点伸出的长度 3 的尾巴（rho，尾巴 3 + 环 n）；
- **测试点**：n = 4 / 6 / 8；
- **参考解**：

```python
def solve(s):
    tail = s
    for _ in range(3):
        tail.link(Node())
        tail = tail.next()
    return s
```

- **实测**：4+3 → 10 步，峰值 3。
- **注意**：`s` 是环节点，加尾巴后它的出度变 2；不要再用 `s.next()` 走环。
- **预算**：`max_refs 3`，`max_steps 20`。

### 6. Triple chain ✅

- **输入**：n 节点链；**目标**：3n+1 节点的新链，`return_new`；
- **测试点**：n = 2 / 3 / 4；
- **参考解**：

```python
def solve(s):
    out = Node()
    tail = out
    while s is not None:
        tail.link(Node()); tail = tail.next()
        tail.link(Node()); tail = tail.next()
        tail.link(Node()); tail = tail.next()
        s = s.next()
    return out
```

- **实测**：n=3 → 32 步，峰值 4。
- **考点**：每个输入节点产生固定数量的输出；是 Double 的加强版。
- **预算**：`max_refs 4`，`max_steps 10n+10`。

### 7. Thin out ✅

- **输入**：2n 节点链；**目标**：n 节点链（原地删，不新建）；
- **测试点**：2n = 4 / 6 / 8；
- **参考解**：

```python
def solve(s):
    head = s
    p = s
    while p is not None:
        v = p.next()
        if v is None:
            break
        nxt = v.next()
        p.unlink(v)
        if nxt is not None:
            p.link(nxt)
        p = nxt
    return head
```

- **实测**：n=2/3/4 → 11/16/21 步，峰值 6。
- **考点**：删节点后必须补边，否则链断；被删节点在变量改写后被 GC。
- **预算**：`max_refs 6`，`max_steps 6n+10`。

### 8. Reverse copy ✅

- **输入**：n 节点链；**目标**：新的 n+1 节点链，顺序与原链相反（每个输入节点前插一个副本）；
- **测试点**：n = 3 / 4 / 5；
- **参考解**：

```python
def solve(s):
    out = Node()
    while s is not None:
        n = Node()
        n.link(out)
        out = n
        s = s.next()
    return out
```

- **实测**：n=4 → 17 步，峰值 4。
- **考点**：不翻转边，靠“头插”得到倒序；`return_new`。
- **预算**：`max_refs 4`，`max_steps 5n+10`。

### 9. Doubly linked ring ✅

- **输入**：n 节点环；**目标**：每个节点同时指向后继和前驱（2n 条边）；
- **测试点**：n = 4 / 6 / 8；
- **参考解**：

```python
def solve(s):
    head = s
    prev = s
    cur = s.next()
    while cur is not head:
        nxt = cur.next()
        cur.link(prev)
        prev = cur
        cur = nxt
    cur.link(prev)
    return head
```

- **实测**：n=4/6 → 16/24 步，峰值 6。
- **注意**：先读 `nxt` 再连回边；最后补上 head 的 prev 边。
- **预算**：`max_refs 6`，`max_steps 5n+10`。

### 10. Comb ✅

- **输入**：n 节点链；**目标**：每个节点挂一个叶子（2n 节点，2n−1 边）；
- **测试点**：n = 3 / 4 / 5；
- **参考解**：

```python
def solve(s):
    head = s
    p = s
    nxt = p.next()
    while nxt is not None:
        p.link(Node())
        p = nxt
        nxt = p.next()
    p.link(Node())
    return head
```

- **实测**：n=4 → 17 步，峰值 5。
- **注意**：挂叶子会让 `p` 出度变 2；`nxt` 必须在挂叶子前读出来。
- **预算**：`max_refs 5`，`max_steps 5n+10`。

### 11. Caterpillar ring ✅

- **输入**：n 节点环；**目标**：每个环节点挂一个叶子（2n 节点，2n 边）；
- **测试点**：n = 3 / 4 / 5；
- **参考解**：

```python
def solve(s):
    head = s
    p = s
    nxt = p.next()
    while s is not None:
        p.link(Node())
        p = nxt
        nxt = p.next()
        if p is s:
            break
    return head
```

- **实测**：n=4 → 19 步，峰值 5。
- **考点**：环 + 叶子，收尾用 `is` 判断回到起点。
- **预算**：`max_refs 5`，`max_steps 5n+10`。

### 12. Ring of rings ✅

- **输入**：n 节点环；**目标**：每个环节点挂一个 3 节点环（4n 节点，5n 边）；
- **测试点**：n = 2 / 3；
- **参考解**：

```python
def solve(s):
    head = s
    p = s
    nxt = p.next()
    while s is not None:
        a = Node()
        b = Node()
        c = Node()
        p.link(a)
        a.link(b)
        b.link(c)
        c.link(a)
        p = nxt
        nxt = p.next()
        if p is s:
            break
    return head
```

- **实测**：n=2 → 21 步，峰值 8。
- **注意**：每个环节点多一条出边，必须提前保存 `nxt`；峰值很高，是引用预算题。
- **预算**：`max_refs 8`，`max_steps 12n+10`。

---

## 第三章（计算向，难）

### 13. Square chain ✅

- **输入**：n 节点链；**目标**：1+2n² 节点的新链，`return_new`；
- **测试点**：n = 2 / 3（9 / 19 节点）；
- **参考解**：

```python
def solve(s):
    head = s
    out = Node()
    tail = out
    outer = s
    while outer is not None:
        inner = head
        while inner is not None:
            tail.link(Node()); tail = tail.next()
            tail.link(Node()); tail = tail.next()
            inner = inner.next()
        outer = outer.next()
    return out
```

- **实测**：n=2/3 → 36/73 步，峰值 7。
- **考点**：嵌套循环；`head` 必须一直活着，内层才能重走。
- **预算**：`max_refs 7`，`max_steps 15n²+20`。

### 14. Threaded tree ◇

- **输入**：d 节点链（链长 = 树的深度）；**目标**：深度 d 的满二叉树 + 每层节点按顺序串成链表（树边 + 线程边），`return_new`；
- **测试点**：d = 2 / 3（7 / 15 节点）；
- **算法**：
  1. 用输入链当计数器：每个输入节点长一层；
  2. 维护当前层的 frontier 链（head/tail）；
  3. 对 frontier 里每个节点：先读 `nxt`，新建两个孩子，连父子边，把孩子接到下一层 frontier；
  4. 下一层成为当前层，重复到输入链走完；
- **难点**：同时维护两层链；父子边会让节点出度变 3，必须提前读 `nxt`；
- **预算**：`max_refs 9`，`max_steps O(2^d)`；判题器已能处理 15 节点。

### 15. Exponential chain ◇

- **输入**：n 节点链；**目标**：2ⁿ 节点的新链，`return_new`；
- **测试点**：n = 3 / 4（8 / 16 节点）；
- **算法**：
  1. 当前输出链头 `out`，尾 `tail`；
  2. 对每个输入节点：记住当前尾 `old`；从 `out` 走到 `old`，每走一个节点就在尾部追加一个副本（先读 next 再追加）；
  3. 旧尾作为边界，保证不会走进新副本；
- **难点**：O(2ⁿ) 增长；遍历与追加共用一条链，边界必须精确；
- **预算**：`max_refs 6`，节点数上限 4096，判题器支持 16 节点。

### 16. Ternary tree ✅

- **输入**：单个根；**目标**：深度 2 的满三叉树（13 节点，12 边）；
- **测试点**：1；
- **参考解**：

```python
def solve(s):
    a = Node(); b = Node(); c = Node()
    s.link(a); s.link(b); s.link(c)
    a.link(Node()); a.link(Node()); a.link(Node())
    b.link(Node()); b.link(Node()); b.link(Node())
    c.link(Node()); c.link(Node()); c.link(Node())
    return s
```

- **实测**：24 步，峰值 5。
- **考点**：固定结构的展开；和 Binary tree 同一类，但更宽。

### 17. 3×3 grid ◇

- **输入**：单个根；**目标**：3×3 网格（9 节点，12 条边：3 行 × 2 + 3 列 × 2）；
- **测试点**：1（或 2×3 / 3×4 变体）；
- **算法**：
  1. 建第 1 行 3 个节点，串成链；
  2. 建下一行时，每建一个节点就向上连到上一行对应节点；保留上一行 3 个引用，行末更新；
  3. 重复 3 行；
- **难点**：同时保留上一行的三个引用；行内链和列边交替。
- **预算**：`max_refs 8`，`max_steps 60`。

### 18. Hypercube Q3 ◇

- **输入**：单个根；**目标**：3 维超立方（8 节点，12 条边，每个节点度 3）；
- **测试点**：1；
- **算法**：按层建两个 4 环（bottom/top），再把对应节点连起来；
- **难点**：8 个节点的对应关系；建议先建两个 4 环，再用 4 条竖边连起来；
- **预算**：`max_refs 8`，`max_steps 80`。

### 19. Copy a doubly linked ring ◇

- **输入**：n 节点环；**目标**：新的、每节点带 prev 的环（2n 条边），`return_new`；
- **测试点**：n = 4 / 6；
- **算法**：在 Copy a ring 的基础上，每建一个副本就同时连一条回边；收口时补上环的第一个副本的 prev；
- **难点**：复制和回边同时做，引用紧张；
- **预算**：`max_refs 8`，`max_steps 10n+20`。

### 20. Turing tape ◇

- **输入**：一条纸带（节点链），用“边到标记节点”表示 1，空表示 0；
- **目标**：模拟一个固定的小型图灵机 k 步，输出纸带形状；
- **测试点**：固定；
- **需要先定**：
  1. 纸带编码（节点/边怎么表示 0/1/空白/读写头）；
  2. 判题扩展（形状 + 指定节点的标记边）；
- **难点**：读写头、状态、左右移动、停机；这已经是写解释器，不是写算法。

---

## 建议的章节编排

现有 12 关 + 新 20 关 = 32 关：

| 章节 | 内容 |
| --- | --- |
| 第一章 · 规则（带参考解） | 现有 6 关 + Star / Extend a chain / Cut the prefix / Drop the tail |
| 第二章 · 结构（无参考解） | 现有 6 关 + Ring with a tail / Triple chain / Thin out / Reverse copy / Doubly linked ring / Comb / Caterpillar ring / Ring of rings |
| 第三章 · 计算（无参考解） | Square chain / Threaded tree / Exponential chain / Ternary tree / 3×3 grid / Hypercube Q3 / Copy a doubly linked ring / Turing tape |

第二章会到 14 关，可以再拆一个「指针技巧」和「环与网格」；第三章只放真正需要嵌套循环或数据结构的题。

## 实现顺序建议

1. 先做 ✅ 的 14 关：参考解现成，改 `levels.js` + 章节数据即可；
2. 再做 ◇ 里最容易验证的两个：Ternary tree（已经 ✅）、3×3 grid；
3. Threaded tree / Exponential chain 需要新写参考解并调 `max_refs`；
4. Turing tape 放到最后，先把纸带编码和判题扩展定下来。

---

## Bonus：Copy a tree ✅（已上线）

原以为一般图 copy 不可能，但用 **unlink 枚举 + worklist** 可以复制树：

- 队列节点 `Q`：`Q.next()` 随机弹一个 item，`Q.unlink(item)` 移除；
- item 做成临时链 `item → copy → original`：`cv = item.next()`、`v = cv.next()`，再 `cv.unlink(v)`；
- 枚举 `v` 的子节点：`vv = v.next()`、`v.unlink(vv)`，直到 `None`（每个孩子恰好一次）；
- 每个孩子建 `cn`，连 `cv → cn`，再建 `ni → cn`、`cn → vv`（临时），把 `ni` 放进 `Q`；
- 树遍历完，原树被摘空、GC 回收，返回 `croot`。

实测：

| 深度 | 节点 | 步数 | 峰值 |
| --- | --- | --- | --- |
| 2 | 7 | 103 | 11 |
| 3 | 15 | 223 | 11 |
| 4 | 31 | 463 | 11 |

**边界**：这是**边的展开（unfolding）**。树（每个节点入度 ≤ 1）能精确复制；如果有 merge/环，同一个节点会按入边复制多份——结果是展开树，不是同构 copy。要真正复制带 merge 的图，仍需要 visited / 映射原语。

关卡已作为 `13-copy-tree` 上线，`max_refs 12`，测试点 7/15/31 节点。
