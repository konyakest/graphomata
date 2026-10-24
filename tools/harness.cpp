// Runner for a C++ solution: reads a level spec, calls gm_solve(), writes a
// trace.  Compile together with exactly one example:
//
//   g++ -std=c++20 -O2 -Iinclude examples/cpp/03_reverse.cpp tools/harness.cpp
//
// Usage: a.out spec.txt trace.json
#include <graphomata/gm.hpp>

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

// Defined by the player's file.
void gm_solve(gm::World& w);

int main(int argc, char** argv) {
  if (argc < 3) {
    std::cerr << "usage: harness spec.txt trace.json\n";
    return 2;
  }
  std::ifstream in(argv[1]);
  if (!in) {
    std::cerr << "cannot read spec " << argv[1] << "\n";
    return 2;
  }

  std::string id = "level";
  int budget = 0, nodes = 0;
  std::uint64_t seed = 0;
  std::vector<std::pair<int, int>> edges;
  std::vector<std::pair<int, int>> workers;

  std::string line;
  while (std::getline(in, line)) {
    std::istringstream ls(line);
    std::string key;
    if (!(ls >> key) || key.empty() || key[0] == '#') continue;
    if (key == "id") {
      ls >> id;
    } else if (key == "seed") {
      ls >> seed;
    } else if (key == "budget") {
      ls >> budget;
    } else if (key == "nodes") {
      ls >> nodes;
    } else if (key == "edge") {
      int u, v;
      ls >> u >> v;
      edges.emplace_back(u, v);
    } else if (key == "worker") {
      std::string name;
      int node;
      ls >> name >> node;
      if (!name.empty()) workers.emplace_back(std::string("habcdefg").find(name[0]), node);
    }
  }

  gm::World w(budget, seed);
  for (int i = 0; i < nodes; ++i) w.add_node();
  for (auto [u, v] : edges) w.add_edge(u, v);
  for (auto [c, n] : workers)
    if (c >= 0 && c < gm::kNumWorkers) w.set_worker(static_cast<gm::Cursor>(c), n);
  w.start();

  try {
    gm_solve(w);
  } catch (const std::exception& e) {
    w.set_error(e.what());
  }

  std::ofstream out(argv[2]);
  out << w.trace_json(id);
  out.close();

  std::cout << "ops=" << w.ops() << " peak=" << w.peak_registers();
  if (!w.error().empty()) std::cout << " error=\"" << w.error() << "\"";
  std::cout << "\n";
  return w.error().empty() ? 0 : 1;
}
