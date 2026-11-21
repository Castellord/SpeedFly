"""Run inside Unreal Editor before cooking the Mac build."""
from pathlib import Path
import unreal as ue

project = Path(ue.Paths.convert_relative_path_to_full(ue.Paths.project_dir()))
root = "/Game/Ridgeline"
assets = ue.EditorAssetLibrary
tools = ue.AssetToolsHelpers.get_asset_tools()
graph = ue.MaterialEditingLibrary


def import_asset(file, name, asset_type):
    target = f"{root}/{name}"
    if assets.does_asset_exist(target):
        return assets.load_asset(target)
    task = ue.AssetImportTask()
    task.filename = str(file)
    task.destination_path = f"{root}/Imports/{name}"
    task.automated = True
    task.save = True
    tools.import_asset_tasks([task])
    # Interchange may choose a node name instead of the source filename.
    paths = assets.list_assets(task.destination_path, recursive=True, include_folder=False)
    matches = [p for p in paths if isinstance(assets.load_asset(p), asset_type)]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one {asset_type.__name__} from {file}, got {matches}")
    if not assets.rename_asset(matches[0], target):
        raise RuntimeError("Could not move imported asset to " + target)
    return assets.load_asset(target)


def material(name):
    return tools.create_asset(name, root, ue.Material, ue.MaterialFactoryNew())


def node(mat, kind, x, y):
    return graph.create_material_expression(mat, kind, x, y)


def wire(a, pin, b, socket):
    if not graph.connect_material_expressions(a, pin, b, socket):
        raise RuntimeError(f"Material connection failed: {pin} -> {socket}")


def output(expr, pin, material_property):
    if not graph.connect_material_property(expr, pin, material_property):
        raise RuntimeError("Could not connect material property " + str(material_property))


def terrain_material(meadow, cliff):
    mat = material("AlpineSurface")
    mat.set_editor_property("two_sided", True)
    cover = node(mat, ue.MaterialExpressionVertexColor, -620, 90)
    grass = node(mat, ue.MaterialExpressionTextureSample, -680, -230)
    rock = node(mat, ue.MaterialExpressionTextureSample, -680, -50)
    grass.set_editor_property("texture", meadow)
    rock.set_editor_property("texture", cliff)
    soil = node(mat, ue.MaterialExpressionLinearInterpolate, -370, -120)
    wire(grass, "RGB", soil, "A")
    wire(rock, "RGB", soil, "B")
    wire(cover, "R", soil, "Alpha")
    ice = node(mat, ue.MaterialExpressionConstant3Vector, -340, 130)
    ice.set_editor_property("constant", ue.LinearColor(.78, .86, .88, 1))
    snow = node(mat, ue.MaterialExpressionLinearInterpolate, -110, 0)
    wire(soil, "", snow, "A")
    wire(ice, "", snow, "B")
    wire(cover, "G", snow, "Alpha")
    output(snow, "", ue.MaterialProperty.MP_BASE_COLOR)
    rough = node(mat, ue.MaterialExpressionConstant, -110, 230)
    rough.set_editor_property("r", .88)
    output(rough, "", ue.MaterialProperty.MP_ROUGHNESS)
    graph.recompile_material(mat)


def main():
    assets.make_directory(root)
    for name in ("Spruce", "Larch", "Pine", "Boulder", "Slab", "Speedwing", "LeftRiser", "RightRiser"):
        import_asset(project / "Art" / (name + ".glb"), name, ue.StaticMesh)
    meadow, cliff = [import_asset(project / "Intermediate/SourceArt" / (n + ".jpg"), n, ue.Texture2D)
                     for n in ("Meadow", "Cliff")]
    if not assets.does_asset_exist(root + "/AlpineSurface"):
        terrain_material(meadow, cliff)
    if not assets.does_asset_exist(root + "/GatePaint"):
        mat = material("GatePaint")
        mat.set_editor_property("two_sided", True)
        paint = node(mat, ue.MaterialExpressionVertexColor, -260, 0)
        output(paint, "RGB", ue.MaterialProperty.MP_BASE_COLOR)
        graph.recompile_material(mat)
    if not assets.does_asset_exist(root + "/AlpinePass"):
        if not tools.create_asset("AlpinePass", root, ue.World, ue.WorldFactory()):
            raise RuntimeError("Could not create the playable level")
    assets.save_directory(root)
    (project / "Intermediate/art-ready").write_text("ready\n")


main()
