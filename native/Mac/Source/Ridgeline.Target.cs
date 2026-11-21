using UnrealBuildTool;
using System.Collections.Generic;

public class RidgelineTarget : TargetRules
{
    public RidgelineTarget(TargetInfo target) : base(target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("Ridgeline");
    }
}
