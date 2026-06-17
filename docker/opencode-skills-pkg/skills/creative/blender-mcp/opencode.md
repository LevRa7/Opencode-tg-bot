# Blender MCP

Control a running Blender instance via socket on TCP port 9876. Create 3D objects, materials, animations, run arbitrary bpy code.

## Setup

### 1. Install the Blender addon

```bash
curl -sL https://raw.githubusercontent.com/ahujasid/blender-mcp/main/addon.py -o ~/Desktop/blender_mcp_addon.py
```

In Blender: Edit > Preferences > Add-ons > Install > select blender_mcp_addon.py, enable "Interface: Blender MCP".

### 2. Start the socket server

Press N in Blender viewport to open sidebar. Find "BlenderMCP" tab and click "Start Server".

### 3. Verify connection

```bash
nc -z -w2 localhost 9876 && echo "OPEN" || echo "CLOSED"
```

## Protocol

Plain UTF-8 JSON over TCP. Send: `{"type": "<command>", "params": {<kwargs>}}`. Receive: `{"status": "success", "result": <value>}`.

## Available Commands

| type | params | description |
|------|--------|-------------|
| execute_code | code (str) | Run arbitrary bpy Python |
| get_scene_info | (none) | List all scene objects |
| get_object_info | object_name (str) | Object details |
| get_viewport_screenshot | (none) | Viewport screenshot |

## Common bpy Patterns

```python
# Clear scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# Add mesh
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, 0, 0))

# Create material
mat = bpy.data.materials.new(name="MyMat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.8, 0.2, 0.2, 1.0)

# Keyframe animation
obj.location = (0, 0, 0)
obj.keyframe_insert(data_path="location", frame=1)
obj.location = (0, 0, 3)
obj.keyframe_insert(data_path="location", frame=60)

# Render
bpy.context.scene.render.filepath = "/tmp/render.png"
bpy.ops.render.render(write_still=True)
```

## Pitfalls

- Check socket is open before running commands
- Addon server must be started in Blender each session
- Break complex scenes into multiple smaller calls to avoid timeouts
- Render output path must be absolute
- `shade_smooth()` requires object selected and in object mode
