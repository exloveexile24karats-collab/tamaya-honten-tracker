# 「玉」アイコンを生成（プラザ2のSDアイコンと同じデザイン）
from PIL import Image, ImageDraw, ImageFont
import sys
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
def make(size, out):
    s = size / 512
    img = Image.new("RGB", (size, size), "#12161d")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([68*s, 68*s, 444*s, 444*s], radius=72*s, outline="#e8b34c", width=max(2, round(14*s)))
    f = ImageFont.truetype(FONT, round(250*s), index=0)
    bbox = d.textbbox((0, 0), "玉", font=f)
    w, h = bbox[2]-bbox[0], bbox[3]-bbox[1]
    d.text(((size-w)/2 - bbox[0], (size-h)/2 - bbox[1]), "玉", font=f, fill="#e8b34c")
    img.save(out)
make(192, sys.argv[1] + "/icon-192.png")
make(512, sys.argv[1] + "/icon-512.png")
