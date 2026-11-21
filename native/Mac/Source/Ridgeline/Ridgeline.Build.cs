using UnrealBuildTool;
using System.IO;

public class Ridgeline : ModuleRules
{
    public Ridgeline(ReadOnlyTargetRules target) : base(target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] {
            "Core", "CoreUObject", "Engine", "InputCore", "ProceduralMeshComponent"
        });
        PublicFrameworks.Add("JavaScriptCore");
        string physics = Path.GetFullPath(Path.Combine(ModuleDirectory, "../../../../src/flight.js"));
        RuntimeDependencies.Add("$(ProjectDir)/Content/Flight/flight.js", physics, StagedFileType.UFS);
    }
}
