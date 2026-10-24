# C++ 模式 — 方案

> 结论：可以支持，但**不是在浏览器里编译真正的 C++**。
> 做一个 C++ 子集前端，把它降成现有指针模式的 AST/解释器；GC、步进、峰值、判题、回放全部复用。
> 目标写法：`Node* a = b->next();`、`nullptr` 判空、`loop(3) { ... }`、`while / if / else / for`。
>
> **状态：已实现。** 前端 `web/ptr/cpp.js`，解释器加了 `block` / `cfor` 和块作用域，
> 12 关都有 C++ starter/reference，编辑器顶部可切 Python / C++；进度按语言分开。

---

## 1. 为什么是子集，不是真编译器

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| A. 浏览器里跑 clang/WASM | 把 C++ 编译成 wasm，再执行 | 真语言，但要几十 MB 工具链、启动慢；与「无构建、静态页面」的现状冲突 |
| **B. C++ 子集前端（本方案）** | 自己写 lexer/parser，降到现有 AST，复用解释器 | 无构建、帧级可控、和 Python 模式共享判题；代价是语言是子集 |
| C. 服务端编译 | 提交到后端编译执行 | 需要服务器、沙箱、超时；现在的 demo 是纯静态的 |

选 B。它和 Python 模式的关系是「两个前端，一个运行时」：同一张图、同一套 GC、同一套步数规则，
所以同一份参考解在两种语言下应该产生**逐帧一致**的 trace（见 §7 的差分测试）。

> 注意：这里的 C++ 不是桌面端 `include/graphomata/gm.hpp` 的 worker API，
> 而是 pointer 模式的第二种书写方式。

---

## 2. 语言子集

### 2.1 固定入口

```cpp
Node* solve(Node* s) {
    ...
}
```

- 只有这一个函数；没有 `main`、没有 `#include`、没有多文件；
- 参数 `s` 是起始节点，返回新的起始节点；
- 只有一种类型：`Node*`；没有 `int`、没有数组、没有字符串；
- 没有 `delete`：节点由 GC 管。

### 2.2 语法

```ebnf
program   := "Node*" "solve" "(" "Node*" NAME ")" block

stmt      := decl | assign ";" | if | while | for | loop
           | "return" expr ";" | "break" ";" | "continue" ";" | ";"

decl      := "Node*" NAME ("=" expr)? ";"          // Node* p; 绑定 nullptr
assign    := NAME "=" expr
if        := "if" "(" expr ")" block ("else" (if | block))?
while     := "while" "(" expr ")" block
for       := "for" "(" (decl | assign | ";") expr? ";" (assign)? ")" block
loop      := "loop" "(" INT ")" block               // 宏式计数循环

block     := "{" stmt* "}"

expr      := or
or        := and ("||" and)*
and       := not ("&&" not)*
not       := "!" not | cmp
cmp       := postfix (("==" | "!=") postfix)?
postfix   := primary ("->" NAME "(" [expr] ")")*
primary   := NAME | "nullptr" | "new" "Node" "(" ")" | "(" expr ")"
```

方法只有三个：`->next()`、`->link(x)`、`->unlink(x)`。

### 2.3 例子

```cpp
// 给 4 节点链加回边（第 7 关）
Node* solve(Node* s) {
    Node* head = s;
    Node* nxt = s->next();
    while (nxt != nullptr) {
        Node* nn = nxt->next();   // 先读，再连回边
        nxt->link(s);
        s = nxt;
        nxt = nn;
    }
    return head;
}
```

```cpp
// 计数循环：从单节点长 3 条边（第 2 关）
Node* solve(Node* s) {
    Node* cur = s;
    loop(3) {
        cur->link(new Node());
        cur = cur->next();
    }
    return s;
}
```

```cpp
// for 走链，把尾巴接回头（第 4 关）
Node* solve(Node* s) {
    Node* head = s;
    Node* p = s;
    for (; p->next() != nullptr; p = p->next()) {
    }
    p->link(head);
    return head;
}
```

### 2.4 `loop(3)` 的定位

- 它**不是**真正的预处理器宏，而是 parser 里的语法糖，直接降成 `for { count: 3 }`；
- 参数只能是整数常量，范围 0–10000（和 Python 的 `range` 一致）；
- 不引入 `int` 变量，所以玩家不会遇到 `i++` / `i < n` 这些需要整数运算的东西；
- 如果以后要真宏，可以换成 `#define loop(n) for (int _i = 0; _i < n; _i++)`，但那就得支持 `int`。

---

## 3. 步数、峰值、作用域

### 3.1 步数（与 Python 模式同规则）

| 写法 | 步 |
| --- | --- |
| `new Node()` | 1 |
| `p->next()` | 1 |
| `p->link(q)` / `p->unlink(q)` | 1 |
| `Node* a = b;` / `a = b;` / `a = nullptr;` | 1（move） |
| `Node* a = b->next();` | 1（外层调用与声明合并） |
| `Node* a = b->next()->next();` | 2（链式中间层各 1） |
| `Node* a;` | 0（只声明，nullptr） |
| `while` / `if` / `for` 头、比较、`return` | 0 |

`loop(3)` 的循环头 0 步，只有 body 算。

### 3.2 峰值

- active = 值不为 `nullptr` 的 `Node*` 变量 + 当前活着的表达式临时值；
- 临时值同样有 `b->next()` 这种名字，链式调用原地移动；
- 赋值和 Python 一样吸收最外层调用；
- 峰值仍然决定 `max_refs`。

### 3.3 作用域：C++ 是块作用域，Python 是函数作用域

这是移植时最容易错的地方。Python 版里 `nn = None` 要手动清；C++ 版里 `Node* nn` 在 `while` 的块结束时自动失效。

规则：

- `{ ... }` 是一个作用域；块里声明的 `Node*` 在块结束时销毁（恢复外层同名绑定）；
- `for (Node* p = ...; ...)` 的 `p` 作用域是整个 for；
- 函数参数 `s` 和函数体顶层的声明在 `return` 时全部释放，只有返回值是根；
- 块退出后可能触发 GC（下一次 step 时做），峰值按步统计。

实现：解释器加一个 `block` 节点；进入块时保存 `vars` 快照，退出时恢复。
变量很少（≤ 8），快照成本可以忽略。

---

## 4. 架构

```text
            ┌──────────────┐
  Python ──▶│ py parser    │──┐
            └──────────────┘  │
                              ├──▶ 共享 AST ──▶ Interp ──▶ World ──▶ frames
            ┌──────────────┐  │                  │
  C++    ──▶│ cpp parser   │──┘                  └── GC / peak / steps
            └──────────────┘
```

### 4.1 复用

- `World`（图、GC、随机 next、帧记录）不动；
- `Interp` 的 op/步进/峰值/合并赋值规则不动；
- 判题、多测试点、回放、拖拽、后退全部不动；
- 只是换一个 parser，把 C++ 语法降成同一套 AST。

### 4.2 AST 映射

| C++ | AST |
| --- | --- |
| `Node* a = expr;` | `assign {name:"a", value, decl:true}` |
| `a = expr;` | `assign` |
| `if (c) A else B` | `if` |
| `while (c) B` | `while` |
| `loop(n) B` | `for {count:n}` |
| `for (init; c; upd) B` | `cfor {init, cond, update, body}` |
| `return e;` | `return` |
| `new Node()` | `node` |
| `nullptr` | `none` |
| `p->next()` | `call {recv:p, name:"next"}` |
| `p == nullptr` / `p != q` | `is` / `is not` |
| `!p` / `p && q` / `p || q` | `not` / `and` / `or` |
| `{ ... }` | `block {body}` |

### 4.3 解释器要加的两件事

1. `block`：进入/退出作用域（保存/恢复 vars）；
2. `cfor`：执行 init → 循环（cond → body → update），`continue` 先跑 update，`break` 直接退出。

不需要新的值类型：`Node*` 就是节点 id，`nullptr` 就是 `null`。

---

## 5. UI 与关卡数据

### 5.1 语言切换

编辑器标题栏加一个分段按钮：

```text
[ solution.py | solution.cpp ]   ▶ 运行  ↶ 后退  单步 ⏭  重置  参考解
```

- 切换语言时保存当前代码（按 `level + lang` 存 localStorage），加载另一语言的草稿；
- 语法高亮按语言切换（C++：`Node`、`nullptr`、`new`、`loop`、`while`、`if`、`else`、`for`、`return`、`->`）；
- 运行/单步/提交/测试点逻辑完全不变。

### 5.2 关卡数据

```js
{
  id: "07-double",
  ...
  starters: {
    py: "def solve(s):\n    ...",
    cpp: "Node* solve(Node* s) {\n    ...\n}",
  },
  references: {
    py: "...",
    cpp: "...",
  },
}
```

- 旧字段 `starter` / `reference` 迁移到 `starters.py` / `references.py`；
- 10 关都要写 C++ 参考解（大部分是逐行翻译，注意块作用域和 `next()` 污染）；
- 「参考解」按钮加载当前语言的版本。

### 5.3 进度

建议按 `(关卡, 语言)` 记通过状态：同一关用两种语言各过一遍，标签上可以显示两个小勾。

---

## 6. 判题

完全复用：

- 每个测试点独立 `World`，同样的 `graph / goal / max_refs / max_steps`；
- C++ 的 `return` 为 `nullptr` 视为失败；
- 提交跑全部测试点，失败自动切到第一个失败点，显示它的图；
- 步数/峰值与语言无关，两种语言的参考解应该给出相同的数字。

---

## 7. 测试

1. **差分测试（最重要）**：10 关各写一份 Python 和 C++ 参考解，断言两边
   `steps / peak / 每帧 refs / 最终 nodes+edges` 完全一致；
2. **C++ parser 单测**：缺分号、`->` 写成 `.`、用 `int`、`Node` 写成 `Node*` 以外的类型、`loop(10001)`、`nullptr` 拼错；
3. **作用域测试**：块内声明的变量在块外不可见；同名遮蔽恢复；`for` 的 init 变量在循环外失效；
4. **UI 冒烟**：切换语言、参考解、提交、后退、拖拽各跑一遍；
5. **步数规则测试**：`Node* a = b->next();` 1 步、`Node* a = b->next()->next();` 2 步、`Node* a = b;` 1 步、`Node* a;` 0 步。

---

## 8. 工作量

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| M1 | C++ lexer/parser + AST 降级 | 1.5 天 |
| M2 | 解释器加 `block` / `cfor` + 作用域 | 0.5 天 |
| M3 | 10 关 C++ starter/reference + 差分测试 | 1 天 |
| M4 | 语言切换 UI + 高亮 + 进度 | 0.5 天 |
| M5 | 错误信息/边界/文档 | 0.5 天 |
| 合计 | | **4 天** |

风险主要在 parser 的边界（注释、`else if`、空语句、`->` 链）和块作用域；运行时本身不需要改。

---

## 9. 取舍与开放问题

### 已定

1. **不编译真 C++**：C++ 子集前端，降级到共享 AST；真编译留给未来的 WASM 路线。
2. **只有 `Node*`**：没有 `int`、数组、字符串；计数用 `loop(n)`。
3. **`new Node()`** 建节点，没有 `delete`；GC 负责回收。
4. **`nullptr`** 是唯一空指针写法（不支持 `NULL` / `0`）。
5. **固定入口** `Node* solve(Node* s)`，没有 `main`。
6. **`loop(n)` 是语法糖**，不是预处理器；`n` 是 0–10000 的整数常量。
7. **`for` 只支持指针形式**：`for (Node* p = s; p != nullptr; p = p->next())`；没有 `int i++` 形式。

### 已定（按这个实现）

1. **`new Node()`**：建节点，没有 `delete`，GC 负责回收。
2. **块作用域**：按 C++ 语义实现；解释器用 scope 栈，只在块退出时恢复块内**声明**的名字，块内对外层变量的赋值会保留。
3. **`for` 只有指针形式**；固定次数用 `loop(n)`，不引入 `int` / `++`。
4. **进度按 `(关卡, 语言)` 分开**：同一关用 Python 和 C++ 各过一遍，标签上分别打勾。

### 实现位置

| 内容 | 文件 |
| --- | --- |
| C++ lexer/parser | `web/ptr/cpp.js` |
| 块作用域 / `cfor` | `web/ptr/interp.js` |
| 12 关 C++ starter/reference | `web/ptr/levels.js`（`CPP` 表 + `cppFor()`） |
| 语言切换 / 参考解 / 进度 | `web/ptr/app.js` |
| 高亮 | `web/ptr/app.js`（py/cpp 两套正则） |
| 测试 | `web/ptr/test.js`（C++ 关卡 + 作用域 + parser）、`web/ptr/smoke.js`（切语言 + 提交） |
