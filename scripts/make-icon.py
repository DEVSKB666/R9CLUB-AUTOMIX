from pathlib import Path
from PIL import Image


root = Path(__file__).resolve().parents[1]
source = root / "src" / "assets" / "r9club-logo.png"
ui_output = root / "src" / "assets" / "r9club-logo-ui.png"
output = root / "build" / "icon.ico"
output.parent.mkdir(parents=True, exist_ok=True)

image = Image.open(source).convert("RGBA")
alpha_bounds = image.getchannel("A").getbbox()
if alpha_bounds:
    image = image.crop(alpha_bounds)

side = max(image.size)
padding = max(12, round(side * 0.06))
canvas = Image.new("RGBA", (side + padding * 2, side + padding * 2), (0, 0, 0, 0))
canvas.alpha_composite(image, ((canvas.width - image.width) // 2, (canvas.height - image.height) // 2))
canvas.save(ui_output, optimize=True)
canvas.save(output, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(ui_output)
print(output)
