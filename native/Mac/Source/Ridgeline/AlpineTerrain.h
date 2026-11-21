// Metres, Y up, downhill along negative Z. Rendered triangles and ground
// queries share this grid, including its changing resolution in the distance.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace Ridge {
struct Point {
  double x, y, z;
};
struct Prop {
  Point base;
  double width, height, angle;
  int model;
};
class Terrain {
public:
  std::vector<double> across, down, bends, heights;
  std::vector<Prop> props;
  void Generate(uint32_t seed);
  double Center(double z) const;
  double Height(double x, double z) const;
  bool Hits(double x, double y, double z) const;
  Point Vertex(int i, int j) const {
    return {across[i] + bends[j], heights[j * across.size() + i], -down[j]};
  }

private:
  std::vector<std::vector<int>> buckets;
  double phase = 0;
  double Bend(double d) const;
  double Elevation(double u, double d) const;
};
} // namespace Ridge
