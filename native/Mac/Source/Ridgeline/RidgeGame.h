#pragma once
#include "AlpineTerrain.h"
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "GameFramework/Pawn.h"
#include "MacFlight.h"
#include "RidgeGame.generated.h"

class UAudioComponent;
class USoundWaveProcedural;
class UCameraComponent;
class UHierarchicalInstancedStaticMeshComponent;
class UMaterialInterface;
class UProceduralMeshComponent;
class UStaticMeshComponent;

UCLASS()
class ARidgePawn : public APawn {
  GENERATED_BODY()
public:
  ARidgePawn();
  virtual void BeginPlay() override;
  virtual void Tick(float Dt) override;
  FString Readout() const;
  bool bFlying = false, bFree = false, bGuide = true;

private:
  void GenerateLine();
  void ResetRun();
  void BuildTerrain();
  void BuildMarkers();
  void AddLighting();
  void UpdateGuide();
  void UpdateWind(float Dt);
  Ridge::Terrain Terrain;
  TUniquePtr<Ridge::Flight> Flight;
  Ridge::FlightState State;
  uint32 Seed = 1847;
  float Trim = .5f, GuideTimer = 0;
  bool bHelmet = true, bWind = true;
  uint32 NoiseSeed = 71;
  float WindLevel = 0, LowNoise[2]{};
  UPROPERTY() TObjectPtr<UStaticMeshComponent> LeftHand;
  UPROPERTY() TObjectPtr<UStaticMeshComponent> RightHand;
  UPROPERTY() TObjectPtr<UAudioComponent> Wind;
  UPROPERTY() TObjectPtr<USoundWaveProcedural> WindWave;
  UPROPERTY() TObjectPtr<UProceduralMeshComponent> Glide;
  FString Error;
  UPROPERTY() TObjectPtr<UCameraComponent> Camera;
  UPROPERTY() TObjectPtr<UStaticMeshComponent> Wing;
  UPROPERTY() TObjectPtr<UProceduralMeshComponent> Landscape;
  UPROPERTY() TObjectPtr<UMaterialInterface> LandMaterial;
  UPROPERTY()
  TArray<TObjectPtr<UHierarchicalInstancedStaticMeshComponent>> Scenery;
  UPROPERTY() TObjectPtr<UProceduralMeshComponent> Hoops;
  UPROPERTY() TObjectPtr<UMaterialInterface> MarkerMaterial;
  std::vector<Ridge::Prediction> Prediction;
};
UCLASS()
class ARidgeHUD : public AHUD {
  GENERATED_BODY()
public:
  virtual void DrawHUD() override;
};
UCLASS()
class ARidgeGameMode : public AGameModeBase {
  GENERATED_BODY()
public:
  ARidgeGameMode();
  virtual void
  HandleStartingNewPlayer_Implementation(APlayerController *Player) override;
};
