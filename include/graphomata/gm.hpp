// graphomata-cpp — the graph machine, with a programmer-friendly front end.
//
// The world is a directed graph plus eight "cursors" (h, a..g) that sit on
// nodes or at home (h is immovable and always home).  Five mutating primitives
// are the whole game:
//
//     NODE  w        create a fresh node and put w on it
//     WALK  w        move w along a *random* outgoing edge (home if there is none)
//     JOIN  w, v     w takes v's position (v may be h, i.e. go home)
//     LINK  u, v     add the edge between the nodes u and v sit on
//     UNLINK u, v    remove that edge
//
// Reading state (at / test / edges) is free; every mutation costs one "op".
// Nodes that are neither occupied nor part of any edge are garbage-collected
// after every op — the graph itself is the only memory you get.
//
// Everything the player writes is ordinary C++03..C++20; the ledger below just
// records what the five primitives did, per source line.
#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <ostream>
#include <source_location>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace gm {

enum Cursor : int { H = 0, A, B, C, D, E, F, G };
inline constexpr int kNumWorkers = 8;

inline const char* cursor_name(int c) {
  static const char* names[kNumWorkers] = {"h", "a", "b", "c", "d", "e", "f", "g"};
  return (c >= 0 && c < kNumWorkers) ? names[c] : "?";
}

class GameError : public std::runtime_error {
 public:
  explicit GameError(const std::string& msg) : std::runtime_error(msg) {}
};
class IllegalOp : public GameError {
 public:
  explicit IllegalOp(const std::string& msg) : GameError(msg) {}
};
class BudgetExceeded : public GameError {
 public:
  explicit BudgetExceeded(const std::string& msg) : GameError(msg) {}
};

struct Frame {
  std::string op;
  std::vector<int> args;
  std::vector<int> workers;  // 8 entries, node id or -1 for home
  std::vector<int> nodes;    // live node ids, ascending
  std::vector<std::pair<int, int>> edges;
};

class World {
 public:
  World(int budget, std::uint64_t seed) : budget_(budget), seed_(seed), rng_(seed) {
    workers_.fill(-1);
  }

  World(const World&) = delete;
  World& operator=(const World&) = delete;

  // ---------------------------------------------------------------- setup
  // Setup is free: it is the level, not the solution.
  int add_node() {
    int id = static_cast<int>(nodes_.size());
    nodes_.push_back(Node{});
    return id;
  }

  void add_edge(int u, int v) {
    auto& out = nodes_.at(u).out;
    auto it = std::lower_bound(out.begin(), out.end(), v);
    if (it == out.end() || *it != v) out.insert(it, v);
  }

  void set_worker(Cursor c, int node) {
    if (c == H) return;  // h is immovable
    workers_[c] = node;
  }

  void start() { record("init", {}); }

  // ------------------------------------------------------------ primitives
  Cursor node(Cursor w, std::source_location loc = std::source_location::current()) {
    if (w == H) throw IllegalOp("NODE: h is immutable");
    charge("node", loc);
    int id = static_cast<int>(nodes_.size());
    nodes_.push_back(Node{});
    workers_[w] = id;
    gc();
    record("node", {w});
    return w;
  }

  Cursor walk(Cursor w, std::source_location loc = std::source_location::current()) {
    if (w == H) throw IllegalOp("WALK: h is immutable");
    int at = workers_[w];
    if (at < 0) throw IllegalOp("WALK: cursor is at home");
    charge("walk", loc);
    int to = -1;
    const auto& out = nodes_[at].out;
    if (!out.empty()) to = out[next_rand() % out.size()];
    workers_[w] = to;
    gc();
    record("walk", {w});
    return w;
  }

  Cursor join(Cursor dst, Cursor src,
              std::source_location loc = std::source_location::current()) {
    if (dst == H) throw IllegalOp("JOIN: h is immutable");
    charge("join", loc);
    workers_[dst] = workers_[src];
    gc();
    record("join", {dst, src});
    return dst;
  }

  Cursor link(Cursor a, Cursor b,
              std::source_location loc = std::source_location::current()) {
    if (a == H || b == H) throw IllegalOp("LINK: h is immutable");
    int u = workers_[a], v = workers_[b];
    if (u < 0 || v < 0) throw IllegalOp("LINK: cursor is at home");
    if (u == v) throw IllegalOp("LINK: a node cannot link to itself");
    auto& out = nodes_[u].out;
    auto it = std::lower_bound(out.begin(), out.end(), v);
    if (it != out.end() && *it == v) throw IllegalOp("LINK: edge already exists");
    charge("link", loc);
    out.insert(it, v);
    gc();
    record("link", {a, b});
    return a;
  }

  Cursor unlink(Cursor a, Cursor b,
                std::source_location loc = std::source_location::current()) {
    if (a == H || b == H) throw IllegalOp("UNLINK: h is immutable");
    int u = workers_[a], v = workers_[b];
    if (u < 0 || v < 0) throw IllegalOp("UNLINK: cursor is at home");
    auto& out = nodes_[u].out;
    auto it = std::lower_bound(out.begin(), out.end(), v);
    if (it == out.end() || *it != v) throw IllegalOp("UNLINK: no such edge");
    charge("unlink", loc);
    out.erase(it);
    gc();
    record("unlink", {a, b});
    return a;
  }

  // -------------------------------------------------------------- reading
  // All free.  `test` is the machine's TEST; combined with H it asks
  // "is this cursor at home?".
  bool test(Cursor a, Cursor b) {
    last_test_ = workers_[a] == workers_[b];
    return last_test_;
  }

  bool at(Cursor c) const { return workers_[c] >= 0; }
  bool at_home(Cursor c) const { return workers_[c] < 0; }
  int pos(Cursor c) const { return workers_[c]; }

  bool is_alive(int id) const {
    return id >= 0 && id < static_cast<int>(nodes_.size()) && nodes_[id].alive;
  }

  std::vector<int> live_nodes() const {
    std::vector<int> out;
    for (int i = 0; i < static_cast<int>(nodes_.size()); ++i)
      if (nodes_[i].alive) out.push_back(i);
    return out;
  }

  std::vector<std::pair<int, int>> edges() const {
    std::vector<std::pair<int, int>> out;
    for (int u = 0; u < static_cast<int>(nodes_.size()); ++u)
      if (nodes_[u].alive)
        for (int v : nodes_[u].out) out.emplace_back(u, v);
    return out;
  }

  // ---------------------------------------------------------------- sugar
  // Each of these expands to exactly the primitives named in its body, so the
  // cost is never hidden.
  Cursor peek(Cursor dst, Cursor src,
              std::source_location loc = std::source_location::current()) {
    join(dst, src, loc);
    walk(dst, loc);
    return dst;
  }

  Cursor park(Cursor w, std::source_location loc = std::source_location::current()) {
    join(w, H, loc);
    return w;
  }

  // Free registers are names for cursors that happen to be at home.  spare()
  // is a *query*: calling it twice before moving the cursor returns the same
  // register.  Use spares(k) when you need k distinct ones.
  Cursor spare() const {
    for (int c = A; c <= G; ++c)
      if (workers_[c] < 0) return static_cast<Cursor>(c);
    throw IllegalOp("no free register: park a cursor before allocating another");
  }

  std::vector<Cursor> spares(int k) const {
    std::vector<Cursor> out;
    for (int c = A; c <= G && static_cast<int>(out.size()) < k; ++c)
      if (workers_[c] < 0) out.push_back(static_cast<Cursor>(c));
    if (static_cast<int>(out.size()) < k)
      throw IllegalOp("not enough free registers: park a cursor first");
    return out;
  }

  template <int N>
  std::array<Cursor, N> spares() const {
    const std::vector<Cursor> v = spares(N);
    std::array<Cursor, N> out{};
    for (int i = 0; i < N; ++i) out[i] = v[i];
    return out;
  }

  // ---------------------------------------------------------------- books
  int ops() const { return ops_; }
  int budget() const { return budget_; }
  int peak_registers() const { return peak_; }
  const std::string& error() const { return error_; }
  void set_error(const std::string& what) { error_ = what; }
  uint64_t seed() const { return seed_; }
  void set_seed(uint64_t s) {
    seed_ = s;
    rng_ = s;
  }

  const std::vector<Frame>& frames() const { return frames_; }
  const std::map<std::string, int>& line_costs() const { return line_costs_; }

  std::string trace_json(const std::string& level_id) const;

  // ---------------------------------------------------------------- misc
  std::uint64_t next_rand() {
    std::uint64_t z = (rng_ += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31);
  }

 private:
  struct Node {
    std::vector<int> out;  // sorted, unique
    bool alive = true;
  };

  void charge(const char* op, const std::source_location& loc) {
    if (++ops_ > budget_) {
      std::ostringstream os;
      os << "budget exceeded: the level allows " << budget_ << " ops";
      throw BudgetExceeded(os.str());
    }
    std::string file = loc.file_name() ? loc.file_name() : "?";
    auto slash = file.find_last_of("/\\");
    if (slash != std::string::npos) file = file.substr(slash + 1);
    line_costs_[file + ":" + std::to_string(loc.line())] += 1;
    (void)op;
  }

  void gc() {
    std::vector<char> keep(nodes_.size(), 0);
    for (int c = 0; c < kNumWorkers; ++c)
      if (workers_[c] >= 0) keep[workers_[c]] = 1;
    for (std::size_t u = 0; u < nodes_.size(); ++u) {
      if (!nodes_[u].out.empty()) keep[u] = 1;
      for (int v : nodes_[u].out) keep[v] = 1;
    }
    for (std::size_t i = 0; i < nodes_.size(); ++i)
      if (!keep[i]) nodes_[i].alive = false;
  }

  void record(const std::string& op, std::vector<int> args) {
    Frame f;
    f.op = op;
    f.args = std::move(args);
    f.workers.assign(workers_.begin(), workers_.end());
    for (int i = 0; i < static_cast<int>(nodes_.size()); ++i)
      if (nodes_[i].alive) f.nodes.push_back(i);
    f.edges = edges();
    frames_.push_back(std::move(f));
    int used = 0;
    for (int c = A; c <= G; ++c) used += workers_[c] >= 0;
    peak_ = std::max(peak_, used);
  }

  std::vector<Node> nodes_;
  std::array<int, kNumWorkers> workers_{};
  int budget_ = 0;
  int ops_ = 0;
  int peak_ = 0;
  std::uint64_t seed_ = 0;
  std::uint64_t rng_ = 0;
  bool last_test_ = false;
  std::string error_;
  std::vector<Frame> frames_;
  std::map<std::string, int> line_costs_;
};

// ---------------------------------------------------------------- trace I/O

inline std::string json_escape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04x", c);
          out += buf;
        } else {
          out += c;
        }
    }
  }
  return out;
}

inline std::string trace_json(const World& w, const std::string& level_id) {
  std::ostringstream os;
  os << "{\n";
  os << "  \"level\": \"" << json_escape(level_id) << "\",\n";
  os << "  \"seed\": " << w.seed() << ",\n";
  os << "  \"budget\": " << w.budget() << ",\n";
  os << "  \"ops\": " << w.ops() << ",\n";
  os << "  \"peak_registers\": " << w.peak_registers() << ",\n";
  os << "  \"error\": ";
  if (w.error().empty()) os << "null";
  else os << "\"" << json_escape(w.error()) << "\"";
  os << ",\n";
  os << "  \"line_costs\": {";
  bool first = true;
  for (const auto& [k, v] : w.line_costs()) {
    os << (first ? "\n" : ",\n") << "    \"" << json_escape(k) << "\": " << v;
    first = false;
  }
  os << (first ? "}" : "\n  }") << ",\n";
  os << "  \"frames\": [\n";
  const auto& frames = w.frames();
  for (std::size_t i = 0; i < frames.size(); ++i) {
    const Frame& f = frames[i];
    os << "    {\"op\": \"" << f.op << "\", \"args\": [";
    for (std::size_t j = 0; j < f.args.size(); ++j) os << (j ? ", " : "") << f.args[j];
    os << "], \"workers\": [";
    for (int j = 0; j < kNumWorkers; ++j) os << (j ? ", " : "") << f.workers[j];
    os << "], \"nodes\": [";
    for (std::size_t j = 0; j < f.nodes.size(); ++j) os << (j ? ", " : "") << f.nodes[j];
    os << "], \"edges\": [";
    for (std::size_t j = 0; j < f.edges.size(); ++j)
      os << (j ? ", " : "") << "[" << f.edges[j].first << ", " << f.edges[j].second << "]";
    os << "]}" << (i + 1 == frames.size() ? "\n" : ",\n");
  }
  os << "  ]\n}\n";
  return os.str();
}

inline std::string World::trace_json(const std::string& level_id) const {
  return gm::trace_json(*this, level_id);
}

}  // namespace gm
