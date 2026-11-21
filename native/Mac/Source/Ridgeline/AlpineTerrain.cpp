#include "AlpineTerrain.h"
namespace Ridge {
namespace {
double smooth(double a, double b, double v) {
  const double q = std::clamp((v - a) / (b - a), 0., 1.);
  return q * q * (3. - 2. * q);
}
int cell(const std::vector<double> &axis, double x) {
  return std::clamp(
      int(std::upper_bound(axis.begin(), axis.end(), x) - axis.begin()) - 1, 0,
      int(axis.size()) - 2);
}
} // namespace
double Terrain::Bend(double d) const {
  return 62 * (std::sin(d / 437 + phase) - std::sin(phase)) +
         18 * (std::sin(d / 178 + phase * .6) - std::sin(phase * .6));
}
double Terrain::Elevation(double u, double d) const {
  const double a = std::abs(u), side = u < 0 ? -1. : 1.;
  const double floor = 1840 - .325 * std::clamp(d, -1300., 4700.) +
                       3.4 * std::sin(d / 150 + phase);
  const double face = 65 + 30 * std::sin(d / 225 + phase * side);
  const double layers =
      34 * smooth(face, face + 10, a) + 41 * smooth(face + 53, face + 72, a);
  const double ridge = std::max(
      0., 1. - std::abs(a - 1530 - 260 * std::sin(d / 610 + phase)) / 1690.);
  const double peak = 660 + 425 * std::cos(d / 590 + side * phase) +
                      260 * std::cos(d / 245 + side * .7);
  const double outer = std::max(0., 1. - std::abs(a - 3890) / 1950.);
  const double folds =
      std::abs(std::sin(u / 119 + d / 173 + phase)) * (38 + 55 * ridge);
  return floor + 2.8 * std::sin(d / 80 + phase) * smooth(7, 30, a) + layers +
         smooth(62, 830, a) * (peak * ridge + folds) +
         outer *
             (1050 + 565 * std::sin(d / 800 + side) + 275 * std::cos(d / 401)) +
         4 * smooth(435, 450, d) * (1. - smooth(480, 545, d));
}
void Terrain::Generate(uint32_t seed) {
  across.clear();
  down.clear();
  bends.clear();
  heights.clear();
  props.clear();
  auto random = [&]() {
    seed = seed * 1664525u + 1013904223u;
    return double(seed) / 4294967296.;
  };
  phase = random() * 6.283185;
  std::vector<double> half{0};
  for (double u = 0; u < 6500;) {
    u += u < 128 ? 4 : u < 400 ? 12 : u < 1800 ? 32 : 80;
    half.push_back(u);
  }
  for (auto it = half.rbegin(); it != half.rend() - 1; ++it)
    across.push_back(-*it);
  across.insert(across.end(), half.begin(), half.end());
  for (double d = -3600; d < 9400; d += d < -180 || d > 3600 ? 64 : 8) {
    down.push_back(d);
    bends.push_back(Bend(d));
    for (double u : across)
      heights.push_back(Elevation(u, d));
  }
  buckets.assign(down.size(), {});
  for (int i = 0; i < 6400; ++i) {
    const double d = -100 + random() * 3740, z = -d;
    const bool close = i < 125, tree = random() < .62;
    const double side = random() < .5 ? -1. : 1.;
    const double u = side * (close ? 12 + random() * 13
                                   : 26 + std::pow(random(), 1.6) * 1080);
    const double x = Center(z) + u, y = Height(x, z);
    if (tree &&
        (y > 1930 || (!close && std::sin(d / 126 + u / 57 + phase) > .70)))
      continue;
    const double scale =
        tree ? 4.5 + random() * 10 : 1.2 + std::pow(random(), 2) * 10;
    const int kind = tree ? int(random() * 3) : 3 + int(random() * 2);
    const double h = tree ? scale : scale * (.42 + random() * .32);
    const double w = tree ? scale * .94 : scale;
    props.push_back(
        {{x, y - (tree ? .10 : .12 * scale), z}, w, h, random() * 360, kind});
    const double r = tree ? w * .25 : w * .56;
    for (int j = cell(down, d - r); j <= cell(down, d + r); ++j)
      buckets[j].push_back(int(props.size()) - 1);
  }
}
double Terrain::Center(double z) const {
  const int j = cell(down, -z);
  const double t = std::clamp((-z - down[j]) / (down[j + 1] - down[j]), 0., 1.);
  return bends[j] + (bends[j + 1] - bends[j]) * t;
}
double Terrain::Height(double x, double z) const {
  const int j = cell(down, -z);
  const double u = x - Center(z);
  const int i = cell(across, u);
  const double a =
      std::clamp((u - across[i]) / (across[i + 1] - across[i]), 0., 1.);
  const double b = std::clamp((-z - down[j]) / (down[j + 1] - down[j]), 0., 1.);
  const auto k = j * across.size() + i, n = across.size();
  return a + b <= 1 ? heights[k] + a * (heights[k + 1] - heights[k]) +
                          b * (heights[k + n] - heights[k])
                    : heights[k + n + 1] +
                          (1 - a) * (heights[k + n] - heights[k + n + 1]) +
                          (1 - b) * (heights[k + 1] - heights[k + n + 1]);
}
bool Terrain::Hits(double x, double y, double z) const {
  for (int id : buckets[cell(down, -z)]) {
    const auto &p = props[id];
    const double k = (y - p.base.y) / p.height;
    if (k < 0 || k > 1)
      continue;
    const double r = p.model < 3 ? p.width * std::max(.035, .26 * (1 - k))
                                 : p.width * .47 * std::sqrt(1 - k * k);
    if (std::hypot(x - p.base.x, z - p.base.z) < r)
      return true;
  }
  return false;
}
} // namespace Ridge
