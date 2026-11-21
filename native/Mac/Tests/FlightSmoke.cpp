#include "../Source/Ridgeline/MacFlight.h"
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
void followLine(Ridge::Flight &flight, const Ridge::Terrain &terrain) {
  flight.Reset(false);
  Ridge::Controls input;
  auto s = flight.Read();
  input.trim = s.trim;
  double previousBank = 0, pulse = 0;
  for (int i = 0; s.status == "flying" && i < 18000; ++i) {
    if (i % 12 == 0) {
      const auto &gate = flight.gates.at(s.gate).p;
      const double z = s.p.z - 42;
      const double x =
          terrain.Center(z) + std::clamp((gate.z - z) / 42., 0., 1.) *
                                  (gate.x - terrain.Center(gate.z));
      const double angle = std::atan2(x - s.p.x, 42.) - s.heading;
      pulse += std::clamp(2.3 * std::atan2(std::sin(angle), std::cos(angle)) -
                              .68 * s.bank - .34 * (s.bank - previousBank) / .2,
                          -.95, .95);
      previousBank = s.bank;
      input.right = pulse > .43;
      input.left = pulse < -.43;
      pulse -= input.right - input.left;
      double apron = terrain.Height(x, z);
      for (double offset : {-85., -42., 42., 85.}) {
        const double pz = z + offset;
        apron = std::max(apron, terrain.Height(terrain.Center(pz), pz) -
                                    .325 * offset);
      }
      const double slope = (s.p.y - apron - 9.) / std::hypot(42., x - s.p.x);
      const double trim = std::clamp(
          std::pow(std::max(0., slope - .19) / .42, 1. / 1.16), 0., 1.);
      if (std::abs(trim - input.trim) > .026)
        input.trim = std::clamp(
            input.trim + std::copysign(.05, trim - input.trim), 0., 1.);
    }
    flight.Step(1. / 60, input);
    s = flight.Read();
  }
  std::cout << s.status << ", " << s.passed << " gates at " << s.p.z << " m"
            << std::endl;
  assert(s.status == "finished" && s.passed == 12);
}

int main(int argc, char **argv) {
  assert(argc == 2);
  std::ifstream f(argv[1]);
  std::string code((std::istreambuf_iterator<char>(f)), {});
  assert(!code.empty());
  for (auto seed : {1847, 42, 6}) {
    Ridge::Terrain terrain;
    terrain.Generate(seed);
    for (size_t j = 0; j < terrain.down.size(); j += 17)
      for (size_t i = 0; i < terrain.across.size(); i += 19) {
        auto p = terrain.Vertex(i, j);
        assert(std::abs(terrain.Height(p.x, p.z) - p.y) < 1e-7);
      }
    Ridge::Flight flight(terrain);
    if (!flight.Load(code, seed)) {
      std::cerr << flight.error;
      return 1;
    }
    assert(flight.gates.size() == 12);
    assert(std::abs(flight.Read().agl - 11) < .0001);
    flight.Reset(true);
    assert(std::abs(flight.Read().agl - 350) < .0001);
    Ridge::Controls input;
    input.trim = .5;
    input.fastRight = true;
    input.weight = 1;
    input.right = 1;
    for (int i = 0; i < 30; i++)
      flight.Step(1. / 60, input);
    auto s = flight.Read();
    auto predicted = flight.Predict();
    assert(predicted.size() > 10);
    assert(s.time == flight.Read().time);
    assert(std::abs(s.bank) > .1);
    for (int i = 0; i < 60; i++)
      flight.Step(1. / 60, input);
    auto actual = flight.Read();
    auto p = predicted[5].p;
    assert(std::hypot(std::hypot(p.x - actual.p.x, p.y - actual.p.y),
                      p.z - actual.p.z) < 2.);
    followLine(flight, terrain);
    std::cout << "seed " << seed << ": " << terrain.props.size() << " props, "
              << flight.gates.size() << " gates, prediction verified\n";
  }
}
