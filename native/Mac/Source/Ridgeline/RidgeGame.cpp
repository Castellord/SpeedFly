#include "RidgeGame.h"
#include "Camera/CameraComponent.h"
#include "Components/AudioComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/Canvas.h"
#include "Engine/DirectionalLight.h"
#include "Engine/Engine.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkyLight.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "ProceduralMeshComponent.h"
#include "Sound/SoundWaveProcedural.h"

namespace {
FVector ToUE(Ridge::Point p) { return FVector(-p.z, p.x, p.y) * 100.; }
template <class T> T *Art(const TCHAR *name) {
  const FString path =
      FString::Printf(TEXT("/Game/Ridgeline/%s.%s"), name, name);
  return LoadObject<T>(nullptr, *path);
}
} // namespace
ARidgeGameMode::ARidgeGameMode() {
  DefaultPawnClass = nullptr;
  HUDClass = ARidgeHUD::StaticClass();
}
void ARidgeGameMode::HandleStartingNewPlayer_Implementation(
    APlayerController *Player) {
  Super::HandleStartingNewPlayer_Implementation(Player);
  if (!Player->GetPawn())
    Player->Possess(GetWorld()->SpawnActor<ARidgePawn>());
}
ARidgePawn::ARidgePawn() {
  PrimaryActorTick.bCanEverTick = true;
  SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Origin")));
  Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("HelmetCamera"));
  Camera->SetupAttachment(RootComponent);
  Wing = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Wing"));
  Wing->SetupAttachment(RootComponent);
  Wing->SetCollisionEnabled(ECollisionEnabled::NoCollision);
  Landscape = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Valley"));
  Landscape->SetupAttachment(RootComponent);
  LeftHand = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftRiser"));
  LeftHand->SetupAttachment(Camera);
  RightHand = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightRiser"));
  RightHand->SetupAttachment(Camera);
  for (UStaticMeshComponent *hand : {LeftHand.Get(), RightHand.Get()}) {
    hand->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    hand->SetCastShadow(false);
  }
  Wind = CreateDefaultSubobject<UAudioComponent>(TEXT("Airflow"));
  Wind->SetupAttachment(RootComponent);
  Wind->bAutoActivate = false;
  Wind->bAllowSpatialization = false;
  Glide =
      CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("GlideForecast"));
  Glide->SetupAttachment(RootComponent);
  Glide->SetCastShadow(false);
  Hoops = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Gates"));
  Hoops->SetupAttachment(RootComponent);
}
void ARidgePawn::BeginPlay() {
  Super::BeginPlay();
  LandMaterial = Art<UMaterialInterface>(TEXT("AlpineSurface"));
  MarkerMaterial = Art<UMaterialInterface>(TEXT("GatePaint"));
  Wing->SetStaticMesh(Art<UStaticMesh>(TEXT("Speedwing")));
  LeftHand->SetStaticMesh(Art<UStaticMesh>(TEXT("LeftRiser")));
  RightHand->SetStaticMesh(Art<UStaticMesh>(TEXT("RightRiser")));
  WindWave = NewObject<USoundWaveProcedural>(this);
  WindWave->SetSampleRate(24000);
  WindWave->NumChannels = 2;
  WindWave->Duration = INDEFINITELY_LOOPING_DURATION;
  Wind->SetSound(WindWave);
  const TCHAR *names[] = {TEXT("Spruce"), TEXT("Larch"), TEXT("Pine"),
                          TEXT("Boulder"), TEXT("Slab")};
  for (auto name : names) {
    auto *c = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
    AddInstanceComponent(c);
    c->SetupAttachment(RootComponent);
    c->SetStaticMesh(Art<UStaticMesh>(name));
    c->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    c->SetCullDistances(185000, 270000);
    c->RegisterComponent();
    Scenery.Add(c);
  }
  AddLighting();
  GenerateLine();
}
void ARidgePawn::AddLighting() {
  auto *sun = GetWorld()->SpawnActor<ADirectionalLight>();
  sun->GetLightComponent()->SetMobility(EComponentMobility::Movable);
  sun->SetActorRotation(FRotator(-38, 126, 0));
  auto *light =
      CastChecked<UDirectionalLightComponent>(sun->GetLightComponent());
  light->SetAtmosphereSunLight(true);
  light->SetIntensity(4.4f);
  light->SetLightColor(FLinearColor(1, .89, .76));
  light->DynamicShadowDistanceMovableLight = 64000;
  auto *sky = GetWorld()->SpawnActor<AActor>();
  auto *air = NewObject<USkyAtmosphereComponent>(sky);
  sky->SetRootComponent(air);
  sky->AddInstanceComponent(air);
  air->RegisterComponent();
  auto *fill = GetWorld()->SpawnActor<ASkyLight>();
  fill->GetLightComponent()->SetMobility(EComponentMobility::Movable);
  fill->GetLightComponent()->SetIntensity(1.15f);
  fill->GetLightComponent()->RecaptureSky();
  auto *fog = GetWorld()->SpawnActor<AExponentialHeightFog>();
  fog->SetActorLocation(FVector(0, 0, 92000));
  fog->GetComponent()->SetFogDensity(.012f);
  fog->GetComponent()->SetFogHeightFalloff(.13f);
  auto &post = Camera->PostProcessSettings;
  Camera->PostProcessBlendWeight = 1;
  post.bOverride_MotionBlurAmount = true;
  post.bOverride_MotionBlurMax = true;
  post.MotionBlurMax = 1.8f;
  post.bOverride_SceneFringeIntensity = true;
  post.bOverride_ChromaticAberrationStartOffset = true;
  post.ChromaticAberrationStartOffset = .68f;
}
void ARidgePawn::GenerateLine() {
  bFlying = false;
  Terrain.Generate(Seed);
  FString physics;
  if (!FFileHelper::LoadFileToString(
          physics, *(FPaths::ProjectContentDir() / TEXT("Flight/flight.js")))) {
    Error = TEXT("Missing shared flight model. Run the Mac build script.");
    return;
  }
  Flight = MakeUnique<Ridge::Flight>(Terrain);
  if (!Flight->Load(TCHAR_TO_UTF8(*physics), Seed)) {
    Error = UTF8_TO_TCHAR(Flight->error.c_str());
    Flight.Reset();
    return;
  }
  BuildTerrain();
  TArray<TArray<FTransform>> transforms;
  transforms.SetNum(Scenery.Num());
  for (auto &p : Terrain.props) {
    auto *mesh = Scenery[p.model]->GetStaticMesh();
    if (!mesh)
      continue;
    const auto box = mesh->GetBoundingBox();
    const auto extent = box.GetSize();
    const auto lateral =
        100 * p.width / FMath::Max(1., FMath::Max(extent.X, extent.Y));
    // Trees use a full-height source with a naturally narrow crown.
    const double scaleXY =
        p.model < 3 ? 100 * p.width / FMath::Max(1., extent.Z) : lateral;
    const FVector scale(scaleXY, scaleXY,
                        100 * p.height / FMath::Max(1., extent.Z));
    const FRotator rot(0, p.angle, 0);
    const auto center = box.GetCenter();
    const FVector pivot(center.X, center.Y, box.Min.Z);
    transforms[p.model].Emplace(
        rot, ToUE(p.base) - rot.RotateVector(scale * pivot), scale);
  }
  for (int32 i = 0; i < Scenery.Num(); i++) {
    Scenery[i]->ClearInstances();
    Scenery[i]->AddInstances(transforms[i], false, false);
  }
  BuildMarkers();
  ResetRun();
}
void ARidgePawn::BuildTerrain() {
  Landscape->ClearAllMeshSections();
  int32 section = 0;
  const int32 cols = Terrain.across.size(), rows = Terrain.down.size();
  for (int32 first = 0; first < rows - 1; first += 24) {
    TArray<FVector> points, normals;
    TArray<int32> ix;
    TArray<FVector2D> uv;
    TArray<FLinearColor> colors;
    TArray<FProcMeshTangent> tangents;
    const int32 last = FMath::Min(first + 24, rows - 1);
    for (int32 j = first; j <= last; ++j)
      for (int32 i = 0; i < cols; ++i) {
        auto p = Terrain.Vertex(i, j);
        points.Add(ToUE(p));
        const auto n =
            FVector(
                (Terrain.Height(p.x, p.z + 2) - Terrain.Height(p.x, p.z - 2)) *
                    .25,
                -(Terrain.Height(p.x + 2, p.z) - Terrain.Height(p.x - 2, p.z)) *
                    .25,
                1.)
                .GetSafeNormal();
        normals.Add(n);
        uv.Emplace((p.x + .4 * p.y) / 15., (p.z - .55 * p.y) / 15.);
        const double rock = FMath::Clamp(
            (1. - n.Z) * 3.9 + .15 * FMath::Sin(p.x / 18. + p.z / 33.), 0., 1.);
        const double snow = FMath::Clamp(
            (p.y - 2020 + (n.Z - .8) * 530 + 49 * FMath::Sin(p.x / 66.)) / 250.,
            0., 1.);
        colors.Emplace(rock, snow, 0, 1);
        if (i == cols - 1 || j == last)
          continue;
        const int32 k = (j - first) * cols + i;
        ix.Append({k, k + 1, k + cols, k + 1, k + cols + 1, k + cols});
      }
    Landscape->CreateMeshSection_LinearColor(section, points, ix, normals, uv,
                                             colors, tangents, false, false);
    Landscape->SetMaterial(section++, LandMaterial);
  }
}
void ARidgePawn::BuildMarkers() {
  TArray<FVector> pts, normals;
  TArray<int32> ix;
  TArray<FVector2D> uv;
  TArray<FLinearColor> colors;
  TArray<FProcMeshTangent> tangents;
  for (const auto &g : Flight->gates) {
    const int base = pts.Num();
    for (int i = 0; i < 64; ++i)
      for (int j = 0; j < 6; ++j) {
        const double a = 2 * PI * i / 64, b = 2 * PI * j / 6;
        const FVector radial(0, FMath::Cos(a), FMath::Sin(a)),
            n = radial * FMath::Cos(b) + FVector::ForwardVector * FMath::Sin(b);
        pts.Add(ToUE(g.p) + radial * (g.radius * 100) + n * 14.);
        normals.Add(n);
        uv.Emplace(i / 64., j / 6.);
        colors.Add(i % 16 < 2 ? FLinearColor(.95, .87, .68)
                              : FLinearColor(1, .20, .035));
        const int k = base + i * 6 + j, r = base + ((i + 1) % 64) * 6 + j,
                  v = base + i * 6 + (j + 1) % 6,
                  w = base + ((i + 1) % 64) * 6 + (j + 1) % 6;
        ix.Append({k, r, v, v, r, w});
      }
  }
  Hoops->CreateMeshSection_LinearColor(0, pts, ix, normals, uv, colors,
                                       tangents, false, false);
  Hoops->SetMaterial(0, MarkerMaterial);
}
void ARidgePawn::ResetRun() {
  Flight->Reset(bFree);
  State = Flight->Read();
  Trim = State.trim;
  bFlying = false;
  Prediction.clear();
  GuideTimer = 0;
  Hoops->SetVisibility(!bFree);
}
void ARidgePawn::UpdateGuide() {
  TArray<FVector> pts, normals;
  TArray<int32> ix;
  TArray<FVector2D> uv;
  TArray<FLinearColor> colors;
  TArray<FProcMeshTangent> tangents;
  for (size_t i = 2; i < Prediction.size(); ++i) {
    FVector a = ToUE(Prediction[i - 1].p), b = ToUE(Prediction[i].p);
    a.Z -= 30;
    b.Z -= 30;
    const FVector edge =
        FVector::CrossProduct(b - a, FVector::UpVector).GetSafeNormal() *
        (19. + .5 * i);
    const FLinearColor color =
        Prediction.back().impact && i + 5 >= Prediction.size()
            ? FLinearColor(1, .07, .035)
        : Prediction.back().miss ? FLinearColor(1, .51, .065)
                                 : FLinearColor(.09, .84, .51);
    const int k = pts.Num();
    const FVector end = FMath::Lerp(a, b, .7);
    pts.Append({a - edge, a + edge, end - edge, end + edge});
    for (int n = 0; n < 4; ++n) {
      colors.Add(color);
      normals.Add(FVector::UpVector);
    }
    ix.Append({k, k + 1, k + 2, k + 2, k + 1, k + 3});
  }
  Glide->CreateMeshSection_LinearColor(0, pts, ix, normals, uv, colors,
                                       tangents, false, false);
  Glide->SetMaterial(0, MarkerMaterial);
}
void ARidgePawn::UpdateWind(float dt) {
  if (!bFlying || !bWind) {
    if (Wind->IsPlaying()) {
      Wind->Stop();
      WindWave->ResetAudio();
    }
    WindLevel = 0;
    return;
  }
  const int32 needed =
      FMath::Clamp(1800 - WindWave->GetAvailableAudioByteCount() / 4, 0, 1800);
  WindLevel = FMath::FInterpTo(
      WindLevel, FMath::Clamp(float(State.speed / 34.), 0.f, 1.35f), dt, 4.f);
  TArray<int16> pcm;
  pcm.SetNumUninitialized(needed * 2);
  const float near = FMath::Exp(-float(State.agl) / 12.f);
  for (int i = 0; i < pcm.Num(); ++i) {
    NoiseSeed = NoiseSeed * 1664525u + 1013904223u;
    const float white = float(NoiseSeed >> 8) / 8388608.f - 1.f;
    float &low = LowNoise[i % 2];
    low = .959f * low + .095f * white;
    pcm[i] = int16(
        FMath::Clamp((low * (.73f + .27f * near) + white * .048f * WindLevel) *
                         WindLevel * 14000.f,
                     -32000.f, 32000.f));
  }
  if (needed)
    WindWave->QueueAudio(reinterpret_cast<const uint8 *>(pcm.GetData()),
                         pcm.Num() * sizeof(int16));
  if (!Wind->IsPlaying())
    Wind->Play();
}
void ARidgePawn::Tick(float dt) {
  Super::Tick(dt);
  auto *pc = Cast<APlayerController>(GetController());
  if (!pc || !Flight)
    return;
  auto press = [&](FKey key) { return pc->WasInputKeyJustPressed(key); };
  auto down = [&](FKey key) { return pc->IsInputKeyDown(key); };
  if (press(EKeys::N)) {
    Seed = Seed * 1664525u + 1013904223u;
    GenerateLine();
    if (!Flight)
      return;
  }
  if (press(EKeys::V)) {
    bFree = !bFree;
    ResetRun();
  }
  if (press(EKeys::R))
    ResetRun();
  if (press(EKeys::C))
    bHelmet = !bHelmet;
  if (press(EKeys::H)) {
    bGuide = !bGuide;
    GuideTimer = 0;
  }
  if (press(EKeys::M))
    bWind = !bWind;
  if (press(EKeys::Enter)) {
    if (State.status != "flying")
      ResetRun();
    bFlying = !bFlying;
  }
  if (bFlying) {
    Trim = FMath::Clamp(Trim + float(down(EKeys::Up) - down(EKeys::Down)) * dt *
                                   .40f,
                        0.f, 1.f);
    Ridge::Controls c;
    c.fastLeft = down(EKeys::A) || down(EKeys::SpaceBar);
    c.fastRight = down(EKeys::G) || down(EKeys::SpaceBar);
    c.left = c.fastLeft || down(EKeys::S) || down(EKeys::Left);
    c.right = c.fastRight || down(EKeys::F) || down(EKeys::Right);
    c.weight = down(EKeys::E) - down(EKeys::Q);
    c.trim = Trim;
    Flight->Step(dt, c);
    State = Flight->Read();
    bFlying = State.status == "flying";
    GuideTimer -= dt;
    if (bGuide && GuideTimer <= 0) {
      Prediction = Flight->Predict();
      UpdateGuide();
      GuideTimer = .20f;
    }
  }
  const FVector pilot = ToUE(State.p);
  const FRotator att(FMath::RadiansToDegrees(State.pitch),
                     FMath::RadiansToDegrees(State.heading),
                     FMath::RadiansToDegrees(State.bank));
  Wing->SetVisibility(!bHelmet || !bFlying);
  Wing->SetWorldLocationAndRotation(pilot, att);
  const double rush = FMath::Clamp((34 - State.agl) / 29., 0., 1.) *
                      FMath::Clamp((State.speed - 10) / 18., 0., 1.);
  const bool pov = bHelmet && bFlying;
  const FVector up = att.RotateVector(FVector::UpVector), fwd = att.Vector();
  const FVector eye = pov ? pilot + up * 65 + fwd * 24
                          : pilot - fwd * 1020 + FVector(0, 0, 395);
  Camera->SetWorldLocation(eye);
  Camera->SetWorldRotation(
      pov ? FRotator(att.Pitch - 3. - 4. * rush, att.Yaw, att.Roll)
          : (pilot + FVector(0, 0, 165) + fwd * 120 - eye).Rotation());
  Camera->SetFieldOfView(pov ? 91 + 6 * rush : 74);
  Camera->PostProcessSettings.MotionBlurAmount = bFlying ? .05 + .25 * rush : 0;
  Camera->PostProcessSettings.SceneFringeIntensity = bFlying ? .65 * rush : 0;
  Glide->SetVisibility(bGuide && bFlying);
  LeftHand->SetVisibility(pov);
  RightHand->SetVisibility(pov);
  LeftHand->SetRelativeLocation(FVector(0, 0, -16 * State.left));
  RightHand->SetRelativeLocation(FVector(0, 0, -16 * State.right));
  UpdateWind(dt);
}
FString ARidgePawn::Readout() const {
  if (!Error.IsEmpty())
    return Error;
  const TCHAR *phase = State.status == "crashed"    ? TEXT("Столкновение")
                       : State.status == "landed"   ? TEXT("Посадка")
                       : State.status == "finished" ? TEXT("Финиш")
                       : bFlying                    ? TEXT("В полёте")
                                                    : TEXT("Ожидание");
  return FString::Printf(
      TEXT("%s   %d км/ч   Высота %d м   %+.1f м/с\nТрим %d%%   Ворота %d/12   "
           "%s"),
      bFree ? TEXT("Свободный полёт") : TEXT("Проксимити"),
      FMath::RoundToInt(State.speed * 3.6), FMath::RoundToInt(State.agl),
      State.climb, FMath::RoundToInt(State.trim * 100), State.passed, phase);
}
void ARidgeHUD::DrawHUD() {
  Super::DrawHUD();
  auto *p = Cast<ARidgePawn>(GetOwningPawn());
  if (!p || !Canvas)
    return;
  DrawRect(FLinearColor(0.025, .045, .04, .78), 18, 18, 560, 76);
  DrawText(p->Readout(), FLinearColor::White, 32, 28, GEngine->GetSmallFont(),
           1.15);
  if (!p->bFlying) {
    DrawRect(FLinearColor(.02, .03, .025, .85), 18, Canvas->SizeY - 112, 760,
             94);
    DrawText(
        TEXT("RIDGELINE   /   ENTER  старт или пауза\nA/S и F/G  клеванты    "
             "Пробел  обе    Q/E  перенос веса    ↑/↓  трим\nC  камера    H  "
             "глайд    M  звук    V  режим    N  новая линия    R  сначала"),
        FLinearColor(.92, .96, .89), 32, Canvas->SizeY - 99,
        GEngine->GetSmallFont(), 1.15);
  }
}
