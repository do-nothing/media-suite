from PIL import Image, ImageDraw, ImageFilter
import math

S = 180  # final size
R = int(S * 24 / 120)  # corner radius 24/120 of the 120 design

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# --- diagonal gradient background (violet -> blue) ---
c0 = (124, 58, 237)  # #7c3aed
c1 = (37, 99, 235)   # #2563eb
grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    r = int(c0[0] + (c1[0] - c0[0]) * t)
    g = int(c0[1] + (c1[1] - c0[1]) * t)
    b = int(c0[2] + (c1[2] - c0[2]) * t)
    gd.line([(0, y), (S, y)], fill=(r, g, b, 255))

# rounded-rect clip
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=R, fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)

def sr(x, y, w, h, r, fill, where):
    # draw rounded rect on the given drawer, in design-space fraction of S
    d.rounded_rectangle(
        [int((x) * S / 120), int((y) * S / 120),
         int((x + w) * S / 120), int((y + h) * S / 120)],
        radius=int(r * S / 120),
        fill=fill,
    )

# --- film sprocket holes, left ---
spr = (255, 255, 255, 220)
for ly in (22, 48, 74):
    sr(16, ly, 5, 6, 1, spr, d)
# right
for ly in (22, 48, 74):
    sr(99, ly, 5, 6, 1, spr, d)

# --- white central panel ---
sr(26, 26, 68, 68, 12, (255, 255, 255, 255), d)

# --- blue play triangle (scaled from 120-space to S) ---
tr = S / 120.0
d.polygon(
    [(int(54 * tr), int(50 * tr)), (int(54 * tr), int(70 * tr)), (int(68 * tr), int(62 * tr))],
    fill=(37, 99, 235, 255),
)

img.save("assets/icon-180.png", "PNG")
print("wrote assets/icon-180.png", img.size)