#pragma once
#include "AlpineTerrain.h"
#include <JavaScriptCore/JavaScriptCore.h>
#include <string>
namespace Ridge {
struct Gate {
  Point p;
  double radius;
};
struct Controls {
  double left = 0, right = 0, weight = 0, trim = .5;
  bool fastLeft = false, fastRight = false;
};
struct FlightState {
  Point p{};
  double heading = 0, bank = 0, pitch = 0, speed = 0, agl = 0, trim = 0,
         time = 0, climb = 0, left = 0, right = 0;
  int gate = 0, passed = 0;
  std::string status;
};
struct Prediction {
  Point p;
  bool impact, miss;
};
class Flight {
public:
  explicit Flight(const Terrain &terrain);
  ~Flight();
  Flight(const Flight &) = delete;
  Flight &operator=(const Flight &) = delete;
  bool Load(const std::string &source, uint32_t seed);
  void Reset(bool freeFlight);
  void Step(double seconds, const Controls &controls);
  FlightState Read() const;
  std::vector<Prediction> Predict() const;
  std::vector<Gate> gates;
  std::string error;
  const Terrain &world;

private:
  JSGlobalContextRef ctx = nullptr;
  JSObjectRef flight = nullptr, state = nullptr, input = nullptr,
              step = nullptr;
};
} // namespace Ridge
