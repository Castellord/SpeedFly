#include "MacFlight.h"
#include <cstring>

namespace Ridge {
namespace {
struct String {
  JSStringRef value;
  explicit String(const char *s) : value(JSStringCreateWithUTF8CString(s)) {}
  ~String() { JSStringRelease(value); }
};
std::string text(JSContextRef c, JSValueRef v) {
  JSStringRef s = JSValueToStringCopy(c, v, nullptr);
  std::vector<char> bytes(JSStringGetMaximumUTF8CStringSize(s));
  JSStringGetUTF8CString(s, bytes.data(), bytes.size());
  JSStringRelease(s);
  return bytes.data();
}
JSValueRef prop(JSContextRef c, JSObjectRef o, const char *key) {
  String name(key);
  return JSObjectGetProperty(c, o, name.value, nullptr);
}
void set(JSContextRef c, JSObjectRef o, const char *key, JSValueRef value) {
  String name(key);
  JSObjectSetProperty(c, o, name.value, value, kJSPropertyAttributeNone,
                      nullptr);
}
double num(JSContextRef c, JSObjectRef o, const char *key) {
  return JSValueToNumber(c, prop(c, o, key), nullptr);
}
JSObjectRef obj(JSContextRef c, JSValueRef v) {
  return JSValueToObject(c, v, nullptr);
}
Point point(JSContextRef c, JSObjectRef o) {
  return {num(c, o, "x"), num(c, o, "y"), num(c, o, "z")};
}
const Terrain &terrain(JSContextRef c) {
  return *static_cast<const Terrain *>(
      JSObjectGetPrivate(JSContextGetGlobalObject(c)));
}
JSValueRef height(JSContextRef c, JSObjectRef, JSObjectRef, size_t,
                  const JSValueRef a[], JSValueRef *) {
  return JSValueMakeNumber(
      c, terrain(c).Height(JSValueToNumber(c, a[0], nullptr),
                           JSValueToNumber(c, a[1], nullptr)));
}
JSValueRef center(JSContextRef c, JSObjectRef, JSObjectRef, size_t,
                  const JSValueRef a[], JSValueRef *) {
  return JSValueMakeNumber(
      c, terrain(c).Center(JSValueToNumber(c, a[0], nullptr)));
}
JSValueRef hits(JSContextRef c, JSObjectRef, JSObjectRef, size_t,
                const JSValueRef a[], JSValueRef *) {
  return JSValueMakeBoolean(c,
                            terrain(c).Hits(JSValueToNumber(c, a[0], nullptr),
                                            JSValueToNumber(c, a[1], nullptr),
                                            JSValueToNumber(c, a[2], nullptr)));
}
} // namespace
Flight::Flight(const Terrain &terrain) : world(terrain) {
  JSClassDefinition cls = kJSClassDefinitionEmpty;
  auto type = JSClassCreate(&cls);
  ctx = JSGlobalContextCreate(type);
  JSClassRelease(type);
  JSObjectSetPrivate(JSContextGetGlobalObject(ctx),
                     const_cast<Terrain *>(&world));
}
Flight::~Flight() { JSGlobalContextRelease(ctx); }
bool Flight::Load(const std::string &source, uint32_t seed) {
  auto global = JSContextGetGlobalObject(ctx),
       env = JSObjectMake(ctx, nullptr, nullptr);
  set(ctx, env, "center",
      JSObjectMakeFunctionWithCallback(ctx, nullptr, center));
  set(ctx, env, "height",
      JSObjectMakeFunctionWithCallback(ctx, nullptr, height));
  set(ctx, env, "hitsObstacle",
      JSObjectMakeFunctionWithCallback(ctx, nullptr, hits));
  set(ctx, global, "terrain", env);
  std::string code = source;
  auto pos = code.find("export function createFlight");
  if (pos == std::string::npos) {
    error = "Missing createFlight export";
    return false;
  }
  code.erase(pos, 7);
  code += "\nconst flight=createFlight(terrain," + std::to_string(seed) +
          ");"
          "const predict=()=>{const "
          "p=[];flight.predictGlide(s=>p.push([s.x,s.y,s.z,s.status==='crashed'"
          "||s.status==='landed',s.missed>flight.state.missed]));return p};"
          "Object.assign(globalThis,{flight,predict});";
  JSValueRef errorValue = nullptr;
  String script(code.c_str());
  JSEvaluateScript(ctx, script.value, nullptr, nullptr, 1, &errorValue);
  if (errorValue) {
    error = text(ctx, errorValue);
    return false;
  }
  flight = obj(ctx, prop(ctx, global, "flight"));
  state = obj(ctx, prop(ctx, flight, "state"));
  step = obj(ctx, prop(ctx, flight, "step"));
  input = JSObjectMake(ctx, nullptr, nullptr);
  set(ctx, global, "input", input);
  auto list = obj(ctx, prop(ctx, flight, "gates"));
  gates.clear();
  for (int i = 0; i < int(num(ctx, list, "length")); ++i) {
    auto g = obj(ctx, JSObjectGetPropertyAtIndex(ctx, list, i, nullptr));
    gates.push_back({point(ctx, g), num(ctx, g, "radius")});
  }
  return true;
}
void Flight::Reset(bool freeFlight) {
  String style(freeFlight ? "free" : "line");
  JSValueRef a = JSValueMakeString(ctx, style.value);
  JSObjectCallAsFunction(ctx, obj(ctx, prop(ctx, flight, "reset")), flight, 1,
                         &a, nullptr);
}
void Flight::Step(double seconds, const Controls &in) {
  set(ctx, input, "left", JSValueMakeNumber(ctx, in.left));
  set(ctx, input, "right", JSValueMakeNumber(ctx, in.right));
  set(ctx, input, "fastLeft", JSValueMakeBoolean(ctx, in.fastLeft));
  set(ctx, input, "fastRight", JSValueMakeBoolean(ctx, in.fastRight));
  set(ctx, input, "weight", JSValueMakeNumber(ctx, in.weight));
  set(ctx, input, "trim", JSValueMakeNumber(ctx, in.trim));
  JSValueRef args[] = {JSValueMakeNumber(ctx, seconds), input};
  JSObjectCallAsFunction(ctx, step, flight, 2, args, nullptr);
}
FlightState Flight::Read() const {
  return {point(ctx, state),
          num(ctx, state, "canopyHeading"),
          num(ctx, state, "bank"),
          num(ctx, state, "pitch"),
          num(ctx, state, "speed"),
          num(ctx, state, "agl"),
          num(ctx, state, "trim"),
          num(ctx, state, "time"),
          num(ctx, state, "climb"),
          num(ctx, state, "left"),
          num(ctx, state, "right"),
          int(num(ctx, state, "nextGate")),
          int(num(ctx, state, "passed")),
          text(ctx, prop(ctx, state, "status"))};
}
std::vector<Prediction> Flight::Predict() const {
  auto global = JSContextGetGlobalObject(ctx);
  auto list = obj(
      ctx, JSObjectCallAsFunction(ctx, obj(ctx, prop(ctx, global, "predict")),
                                  global, 0, nullptr, nullptr));
  std::vector<Prediction> points;
  const int count = int(num(ctx, list, "length"));
  points.reserve(count);
  for (int i = 0; i < count; ++i) {
    auto item = obj(ctx, JSObjectGetPropertyAtIndex(ctx, list, i, nullptr));
    auto get = [&](int j) {
      return JSObjectGetPropertyAtIndex(ctx, item, j, nullptr);
    };
    points.push_back({{JSValueToNumber(ctx, get(0), nullptr),
                       JSValueToNumber(ctx, get(1), nullptr),
                       JSValueToNumber(ctx, get(2), nullptr)},
                      JSValueToBoolean(ctx, get(3)),
                      JSValueToBoolean(ctx, get(4))});
  }
  return points;
}
} // namespace Ridge
